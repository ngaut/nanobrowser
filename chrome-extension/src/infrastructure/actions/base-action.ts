import { ActionResult, type AgentContext } from '@src/background/agent/types';
import type { ActionSchema } from '@src/background/agent/actions/schemas';
import { z } from 'zod';
import { createLogger } from '@src/infrastructure/monitoring/logger';
import { ActionExecutionError } from '@src/shared/types/errors';
import { ExecutionState, Actors } from '@src/background/agent/event/types';

const logger = createLogger('BaseAction');

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/**
 * Base action class that encapsulates common action functionality
 */
export abstract class BaseAction<T = any> {
  protected readonly context: AgentContext;
  protected readonly schema: ActionSchema;
  protected readonly hasIndex: boolean;

  constructor(context: AgentContext, schema: ActionSchema, hasIndex: boolean = false) {
    this.context = context;
    this.schema = schema;
    this.hasIndex = hasIndex;
  }

  /**
   * Execute the action with input validation
   */
  async call(input: unknown): Promise<ActionResult> {
    try {
      // Validate input
      const validatedInput = this.validateInput(input);

      // Emit start event
      this.emitStartEvent(validatedInput);

      // Execute the action
      const result = await this.execute(validatedInput);

      // Emit success event
      this.emitSuccessEvent(result);

      return result;
    } catch (error) {
      // Emit error event
      this.emitErrorEvent(error);

      // Re-throw as ActionExecutionError if not already
      if (error instanceof ActionExecutionError) {
        throw error;
      }

      throw new ActionExecutionError(
        `Failed to execute action ${this.name()}: ${error instanceof Error ? error.message : String(error)}`,
        { actionName: this.name(), originalError: error },
      );
    }
  }

  /**
   * Abstract method to be implemented by specific actions
   */
  protected abstract execute(input: T): Promise<ActionResult>;

  /**
   * Get the action name
   */
  name(): string {
    return this.schema.name;
  }

  /**
   * Get the action description
   */
  description(): string {
    return this.schema.description;
  }

  /**
   * Returns the prompt for the action
   */
  prompt(): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schemaShape = (this.schema.schema as z.ZodObject<any>).shape || {};
    const schemaProperties = Object.entries(schemaShape).map(([key, value]) => {
      const zodValue = value as z.ZodTypeAny;
      return `'${key}': {'type': '${zodValue.description}', ${zodValue.isOptional() ? "'optional': true" : "'required': true"}}`;
    });

    const schemaStr =
      schemaProperties.length > 0 ? `{${this.name()}: {${schemaProperties.join(', ')}}}` : `{${this.name()}: {}}`;

    return `${this.schema.description}:\n${schemaStr}`;
  }

  /**
   * Get the index argument from the input if this action has an index
   */
  getIndexArg(input: unknown): number | null {
    if (!this.hasIndex) {
      return null;
    }
    if (input && typeof input === 'object' && 'index' in input) {
      return (input as { index: number }).index;
    }
    return null;
  }

  /**
   * Validate input against the schema
   */
  private validateInput(input: unknown): T {
    const schema = this.schema.schema;

    // Check if the schema is an empty object
    const isEmptySchema =
      schema instanceof z.ZodObject &&
      Object.keys((schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape || {}).length === 0;

    if (isEmptySchema) {
      return {} as T;
    }

    const parsedArgs = this.schema.schema.safeParse(input);
    if (!parsedArgs.success) {
      const errorMessage = parsedArgs.error.message;
      throw new InvalidInputError(errorMessage);
    }

    return parsedArgs.data as T;
  }

  /**
   * Emit action start event
   */
  protected emitStartEvent(input: T): void {
    const baseDetail = this.getBaseDetail(input);
    const finalDetail = `${this.name()}: ${this.getIntentFromInput(input) || baseDetail}`;
    const actStartDetails = { actionName: this.name(), actionArgs: input };

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, actStartDetails);
  }

  /**
   * Emit action success event
   */
  protected emitSuccessEvent(result: ActionResult): void {
    this.context.emitEvent(
      Actors.NAVIGATOR,
      ExecutionState.ACT_OK,
      `Action ${this.name()} successful`,
      undefined,
      result.extractedContent,
    );
  }

  /**
   * Emit action error event
   */
  protected emitErrorEvent(error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Action ${this.name()} failed`, error);

    this.context.emitEvent(
      Actors.NAVIGATOR,
      ExecutionState.ACT_ERROR,
      `Action ${this.name()} failed: ${errorMessage}`,
      undefined,
      { error: errorMessage },
    );
  }

  /**
   * Get base detail message for the action (to be overridden by subclasses)
   */
  protected getBaseDetail(input: T): string {
    return `Executing ${this.name()}`;
  }

  /**
   * Extract intent from input if available
   */
  protected getIntentFromInput(input: T): string | null {
    if (input && typeof input === 'object' && 'intent' in input) {
      return (input as { intent: string }).intent;
    }
    return null;
  }

  /**
   * Create success result with standardized format
   */
  protected createSuccessResult(message: string, includeInMemory: boolean = true): ActionResult {
    return new ActionResult({
      extractedContent: message,
      includeInMemory,
    });
  }

  /**
   * Create error result with standardized format
   */
  protected createErrorResult(message: string, includeInMemory: boolean = true): ActionResult {
    return new ActionResult({
      error: message,
      includeInMemory,
    });
  }

  /**
   * Create done result for completion actions
   */
  protected createDoneResult(message: string): ActionResult {
    return new ActionResult({
      isDone: true,
      extractedContent: message,
    });
  }
}
