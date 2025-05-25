import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { z } from 'zod';
import { ActionResult, type AgentOutput } from '../types';
import { Actors, ExecutionState } from '../event/types';
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import {
  ChatModelAuthError,
  ChatModelForbiddenError,
  isAbortedError,
  isAuthenticationError,
  isForbiddenError,
  LLM_FORBIDDEN_ERROR_MESSAGE,
  RequestCancelledError,
} from './errors';
const logger = createLogger('ValidatorAgent');

// Define Zod schema for validator output
export const validatorOutputSchema = z.object({
  is_valid: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]), // indicates if the output is correct
  reason: z.string(), // explains why it is valid or not
  answer: z.string(), // the final answer to the task if it is valid
});

export type ValidatorOutput = z.infer<typeof validatorOutputSchema>;

interface SourceInfo {
  type: 'url' | 'action_result' | 'message_history';
  identifier: string;
  stepId?: string; // Optional: could reference a specific agent step
  contentSnippet?: string; // Optional: a snippet of the source content
}

export class ValidatorAgent extends BaseAgent<typeof validatorOutputSchema, ValidatorOutput> {
  // sometimes we need to validate the output against both the current browser state and the plan
  private plan: string | null = null;
  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(validatorOutputSchema, options, { ...extraOptions, id: 'validator' });
  }

  /**
   * Set the plan for the validator agent
   * @param plan - The plan to set
   */
  setPlan(plan: string | null): void {
    this.plan = plan;
  }

  /**
   * Executes the validator agent
   * @returns AgentOutput<ValidatorOutput>
   */
  async execute(): Promise<AgentOutput<ValidatorOutput>> {
    let sourceForValidation: SourceInfo | undefined = undefined;
    let dataToValidate = 'Data to validate not found.';

    try {
      // Get current page information from shared context
      const currentPageInfo = await this.context.getCurrentPageInfo();

      // Get action results for validation (simplified approach)
      if (this.context.actionResults && this.context.actionResults.length > 0) {
        for (let i = this.context.actionResults.length - 1; i >= 0; i--) {
          const result = this.context.actionResults[i];
          if (result.extractedContent && !result.error) {
            dataToValidate = result.extractedContent;
            if (result.sourceURL) {
              sourceForValidation = {
                type: 'action_result',
                identifier: result.sourceURL,
                contentSnippet: result.extractedContent.substring(0, 200),
              };
            }
            break;
          }
        }
      }

      const validatorInputDetails = {
        status: 'validating',
        step: this.context.nSteps,

        // Include current page information for validation context
        currentPage: {
          title: currentPageInfo.title,
          url: currentPageInfo.url,
          tabId: currentPageInfo.tabId,
        },

        inputs: {
          dataToValidate,
          sourceURL: sourceForValidation?.type === 'action_result' ? sourceForValidation.identifier : undefined,
          pageContext: `Validating on: "${currentPageInfo.title}" (${currentPageInfo.url})`,
        },
      };

      this.context.emitEvent(
        Actors.VALIDATOR,
        ExecutionState.STEP_START,
        'Validating...',
        undefined,
        validatorInputDetails,
      );

      let stateMessage = await this.prompt.getUserMessage(this.context);
      if (this.plan) {
        const mergedMessage = new HumanMessage(`${stateMessage.content}\n\nThe current plan is: \n${this.plan}`);
        stateMessage = mergedMessage;
      }

      const systemMessage = this.prompt.getSystemMessage();
      const inputMessages = [systemMessage, stateMessage];

      const modelOutput = await this.invoke(inputMessages);
      if (!modelOutput) {
        throw new Error('Failed to validate task result');
      }

      logger.info('validator output', JSON.stringify(modelOutput, null, 2));

      const sourcesArray = sourceForValidation ? [sourceForValidation] : [];

      if (!modelOutput.is_valid) {
        const msg = `The answer is not yet correct. ${modelOutput.reason}.`;
        const validationFailOutput = {
          isValid: modelOutput.is_valid,
          reason: modelOutput.reason,
          answerAttempt: modelOutput.answer,
          sources: sourcesArray,
        };
        this.context.emitEvent(Actors.VALIDATOR, ExecutionState.STEP_FAIL, msg, undefined, validationFailOutput);
        this.context.actionResults = [
          new ActionResult({
            extractedContent: msg,
            includeInMemory: true,
            sourceURL: sourceForValidation?.identifier,
          }),
        ];
      } else {
        const validationSuccessOutput = {
          isValid: modelOutput.is_valid,
          reason: modelOutput.reason,
          validatedAnswer: modelOutput.answer,
          sources: sourcesArray,
        };
        this.context.emitEvent(
          Actors.VALIDATOR,
          ExecutionState.STEP_OK,
          `Validation successful: ${modelOutput.answer}`,
          undefined,
          validationSuccessOutput,
        );
      }

      return {
        id: this.id,
        result: modelOutput,
      };
    } catch (error) {
      // Check if this is an authentication error
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError('Validator API Authentication failed. Please verify your API key', error);
      }
      if (isForbiddenError(error)) {
        throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
      }
      if (isAbortedError(error)) {
        throw new RequestCancelledError((error as Error).message);
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Validation failed: ${errorMessage}`);
      // For system/unexpected errors, the output structure might be simpler
      const systemFailOutput = {
        error: errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
        sources: sourceForValidation ? [sourceForValidation] : [], // Include source if available even on system error
      };
      this.context.emitEvent(
        Actors.VALIDATOR,
        ExecutionState.STEP_FAIL,
        `Validation failed: ${errorMessage}`,
        undefined,
        systemFailOutput,
      );
      return {
        id: this.id,
        error: `Validation failed: ${errorMessage}`,
      };
    }
  }
}
