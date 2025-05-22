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
    try {
      const allMessages = this.context.messageManager.getMessages();
      let taskInstruction = 'Task instruction not found.';
      const taskInstructionPrefix = '<nano_user_request>\nYour ultimate task is: ';
      for (const msg of allMessages) {
        if (
          msg instanceof HumanMessage &&
          typeof msg.content === 'string' &&
          msg.content.startsWith(taskInstructionPrefix)
        ) {
          taskInstruction = msg.content;
          break;
        }
      }

      let originalPlan = 'Original plan not found.';
      for (let i = allMessages.length - 1; i >= 0; i--) {
        const msg = allMessages[i];
        if (msg instanceof AIMessage && typeof msg.content === 'string' && msg.content.startsWith('<plan>')) {
          originalPlan = msg.content;
          break;
        }
      }

      let dataToValidate = 'Data to validate not found (e.g., last Navigator output).';
      // Find the latest Navigator output to validate.
      // This is also a heuristic. Ideally, we'd identify specific Navigator STEP_OK/ACT_OK messages.
      for (let i = allMessages.length - 1; i >= 0; i--) {
        const msg = allMessages[i];
        if (
          msg instanceof HumanMessage &&
          typeof msg.content === 'string' &&
          msg.content.startsWith('Action result:')
        ) {
          dataToValidate = msg.content;
          break;
        }
        // Could also look for AIMessages from Navigator if they represent its final output for a step.
      }

      const validatorInputDetails = {
        status: 'validating',
        step: this.context.nSteps,
        inputs: {
          taskInstruction,
          originalPlan,
          dataToValidate,
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
        // merge the plan and the state message
        const mergedMessage = new HumanMessage(`${stateMessage.content}\n\nThe current plan is: \n${this.plan}`);
        stateMessage = mergedMessage;
      }
      // logger.info('validator input', stateMessage);

      const systemMessage = this.prompt.getSystemMessage();
      const inputMessages = [systemMessage, stateMessage];

      const modelOutput = await this.invoke(inputMessages);
      if (!modelOutput) {
        throw new Error('Failed to validate task result');
      }

      logger.info('validator output', JSON.stringify(modelOutput, null, 2));

      if (!modelOutput.is_valid) {
        // need to update the action results so that other agents can see the error
        const msg = `The answer is not yet correct. ${modelOutput.reason}.`;
        const validationFailDetails = {
          is_valid: modelOutput.is_valid,
          reason: modelOutput.reason,
          answer: modelOutput.answer,
        };
        this.context.emitEvent(Actors.VALIDATOR, ExecutionState.STEP_FAIL, msg, undefined, validationFailDetails);
        this.context.actionResults = [new ActionResult({ extractedContent: msg, includeInMemory: true })];
      } else {
        this.context.emitEvent(
          Actors.VALIDATOR,
          ExecutionState.STEP_OK,
          `Validation successful: ${modelOutput.answer}`,
          undefined,
          modelOutput.answer,
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
      this.context.emitEvent(Actors.VALIDATOR, ExecutionState.STEP_FAIL, `Validation failed: ${errorMessage}`, {
        error: errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      return {
        id: this.id,
        error: `Validation failed: ${errorMessage}`,
      };
    }
  }
}
