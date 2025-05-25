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

      const modelOutput = await this.invoke(plannerMessages);
      if (!modelOutput) {
        throw new Error('Failed to validate planner output');
      }
      this.context.messageManager.addPlan(modelOutput.next_steps);
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
