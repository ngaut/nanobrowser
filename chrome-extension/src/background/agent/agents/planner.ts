import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/infrastructure/monitoring/logger';
import { plannerOutputSchema } from '../types';
import type { AgentOutput, PlannerOutput, PlannerWaitingUserResponse, AgentContext } from '../types';
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { Actors, ExecutionState, EventType } from '../event/types';
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

export class PlannerAgent extends BaseAgent<typeof plannerOutputSchema, PlannerOutput | PlannerWaitingUserResponse> {
  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(plannerOutputSchema, options, { ...extraOptions, id: 'planner' });
  }

  async execute(): Promise<AgentOutput<PlannerOutput | PlannerWaitingUserResponse>> {
    try {
      const messagesForPlannerInput = this.context.messageManager.getMessages();
      let taskInstruction = 'Task instruction not found.';
      const taskInstructionPrefix = '<nano_user_request>\nYour ultimate task is: ';
      for (const msg of messagesForPlannerInput) {
        if (
          msg instanceof HumanMessage &&
          typeof msg.content === 'string' &&
          msg.content.startsWith(taskInstructionPrefix)
        ) {
          taskInstruction = msg.content;
          break;
        }
      }

      // Get current tab information to provide context
      let currentTabInfo = '';
      try {
        const currentPage = await this.context.browserContext.getCurrentPage();
        if (currentPage) {
          const pageTitle = await currentPage.title();
          currentTabInfo = `CURRENT TAB INFO:
- URL: ${currentPage.url || 'Unknown'}
- Title: ${pageTitle || 'Unknown'}
- Is Valid Web Page: ${currentPage.validWebPage ? 'Yes' : 'No'}

You are currently viewing this page and can work with it directly.`;
        }
      } catch (error) {
        logger.info(`Could not get current tab info for task ${this.context.taskId}`, { error: error as Error });
        currentTabInfo = 'CURRENT TAB INFO: Unable to retrieve current tab information.';
      }

      const recentHistoryRaw = messagesForPlannerInput.slice(-5); // Get last 5 messages
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
        inputs: {
          taskInstruction,
          recentHistory,
          currentTabInfo,
        },
      };
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_START, 'Planning...', undefined, plannerInputDetails);

      // get all messages from the message manager, state message should be the last one
      const messages = this.context.messageManager.getMessages();

      // Inject current tab info as context
      const contextMessage = new HumanMessage(currentTabInfo);

      // Use full message history except the first one, with current tab context
      const plannerMessages = [this.prompt.getSystemMessage(), contextMessage, ...messages.slice(1)];

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

      logger.info(`[Task ${this.context.taskId}] About to invoke LLM with ${plannerMessages.length} messages`);

      try {
        const modelOutput = await this.invoke(plannerMessages);
        if (!modelOutput) {
          throw new Error('Failed to validate planner output - modelOutput is null/undefined');
        }

        logger.info(`Planner output received for task ${this.context.taskId}`, {
          messageCount: plannerMessages.length,
          output: JSON.stringify(modelOutput, null, 2),
        });

        // Directly return the plan output for immediate execution (original behavior)
        this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_OK, 'Planning completed', undefined, modelOutput);

        return {
          id: this.id,
          result: modelOutput,
        };
      } catch (invokeError) {
        logger.error(`LLM invocation failed for task ${this.context.taskId}`, invokeError as Error);
        throw invokeError;
      }
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
