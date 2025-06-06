import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { z } from 'zod';
import type { AgentOutput } from '../types';
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { Actors, ExecutionState } from '../event/types';
import {
  ChatModelAuthError,
  ChatModelForbiddenError,
  isAbortedError,
  isAuthenticationError,
  isForbiddenError,
  LLM_FORBIDDEN_ERROR_MESSAGE,
  RequestCancelledError,
} from './errors';
const logger = createLogger('PlannerAgent');

// Define Zod schema for planner output
export const plannerOutputSchema = z.object({
  observation: z.string(),
  challenges: z.string(),
  done: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]),
  next_steps: z.string(),
  reasoning: z.string(),
  web_task: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]),
  page_elements: z.string().optional(), // NEW: Page elements context for Navigator
  observationDataSource_urls: z.array(z.string().url()).optional(),
  observationDataSource_descriptions: z.array(z.string()).optional(),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export class PlannerAgent extends BaseAgent<typeof plannerOutputSchema, PlannerOutput> {
  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(plannerOutputSchema, options, { ...extraOptions, id: 'planner' });
  }

  async execute(): Promise<AgentOutput<PlannerOutput>> {
    try {
      // Get current page information from shared context
      const currentPageInfo = await this.context.getCurrentPageInfo();

      const messagesForPlannerInput = this.context.messageManager.getMessages();

      // Simple recent history for context (no complex parsing)
      const recentHistoryRaw = messagesForPlannerInput.slice(-5);
      const recentHistory = recentHistoryRaw.map(msg => {
        let actorName = 'Unknown';
        if (msg instanceof HumanMessage) actorName = 'User';
        else if (msg instanceof AIMessage) actorName = 'AI';
        else if (msg instanceof SystemMessage) actorName = 'System';
        return `${actorName}: ${typeof msg.content === 'string' ? msg.content.substring(0, 150) + (msg.content.length > 150 ? '...' : '') : '[Non-string content]'}`;
      });

      const plannerInputDetails = {
        status: 'planning',
        step: this.context.nSteps,

        // Include current page information for better planning context
        currentPage: {
          title: currentPageInfo.title,
          url: currentPageInfo.url,
          tabId: currentPageInfo.tabId,
        },

        inputs: {
          recentHistory,
          pageContext: `Currently on: "${currentPageInfo.title}" (${currentPageInfo.url})`,
        },
      };

      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_START, 'Planning...', undefined, plannerInputDetails);

      // Get current browser state so planner can see what's actually on the page
      const currentState = await this.prompt.getUserMessage(this.context);

      // Build planner messages with current browser state
      const plannerMessages = [this.prompt.getSystemMessage(), ...messagesForPlannerInput.slice(1), currentState];

      // Remove images from last message if vision is not enabled for planner but vision is enabled
      if (!this.context.options.useVisionForPlanner && this.context.options.useVision) {
        const lastStateMessage = plannerMessages[plannerMessages.length - 1];
        let newMsg = '';

        if (Array.isArray(lastStateMessage.content)) {
          for (const msg of lastStateMessage.content) {
            if (msg.type === 'text') {
              newMsg += msg.text;
            }
            // Skip image_url messages
          }
        } else {
          newMsg = lastStateMessage.content;
        }

        plannerMessages[plannerMessages.length - 1] = new HumanMessage(newMsg);
      }

      // Debug: Log COMPLETE LLM input
      logger.infoDetailed('🧠 Planner LLM Input - FULL TRACE:', {
        messageCount: plannerMessages.length,
        modelName: this.modelName,
        withStructuredOutput: this.withStructuredOutput,
        useVisionForPlanner: this.context.options.useVisionForPlanner,
      });

      // Critical debugging: Log COMPLETE current state (most important for debugging)
      if (plannerMessages.length > 0) {
        const lastMsg = plannerMessages[plannerMessages.length - 1];
        const lastContentStr =
          typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content || {}, null, 2);
        logger.infoDetailed(`🧠 Current State (Message ${plannerMessages.length - 1}):`, {
          type: lastMsg.constructor.name,
          contentLength: lastContentStr.length,
          fullContent: lastContentStr, // NO TRUNCATION - this is critical for debugging
        });
      }

      const modelOutput = await this.invoke(plannerMessages);
      if (!modelOutput) {
        throw new Error('Failed to validate planner output');
      }

      // Validate that page_elements is provided for web tasks
      if (modelOutput.web_task && (!modelOutput.page_elements || modelOutput.page_elements.trim() === '')) {
        logger.warning('⚠️ Planner output missing page_elements for web task - this may cause Navigator issues');
        // Don't throw error, but log warning for debugging
      }

      // Smart logging: Log key planning decisions without full content dump
      logger.info(
        `🧠 Planner Output: ${modelOutput.done ? 'TASK COMPLETE' : 'CONTINUING'} | Web task: ${modelOutput.web_task}`,
      );
      if (modelOutput.challenges) {
        logger.info(
          `⚠️ Challenges identified: ${modelOutput.challenges.substring(0, 200)}${modelOutput.challenges.length > 200 ? '...' : ''}`,
        );
      }
      if (modelOutput.next_steps) {
        logger.info(
          `📋 Next steps: ${modelOutput.next_steps.substring(0, 300)}${modelOutput.next_steps.length > 300 ? '...' : ''}`,
        );
      }
      // Note: Plan is added to message history by the Executor, not here
      // this.context.messageManager.addPlan(modelOutput.next_steps); // REMOVED: Duplicate plan addition
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_OK, 'Planning successful', undefined, modelOutput);

      return {
        id: this.id,
        result: modelOutput,
      };
    } catch (error) {
      // Check if this is an authentication error
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError('Planner API Authentication failed. Please verify your API key', error);
      }
      if (isForbiddenError(error)) {
        throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
      }
      if (isAbortedError(error)) {
        throw new RequestCancelledError((error as Error).message);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Planning failed: ${errorMessage}`);
      const errorDetails = {
        error: errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
      };
      this.context.emitEvent(
        Actors.PLANNER,
        ExecutionState.STEP_FAIL,
        `Planning failed: ${errorMessage}`,
        undefined,
        errorDetails,
      );
      return {
        id: this.id,
        error: errorMessage,
      };
    }
  }
}
