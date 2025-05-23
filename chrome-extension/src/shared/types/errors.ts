/**
 * Base error class for all nanobrowser errors
 */
export abstract class NanobrowserError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: number;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    this.timestamp = Date.now();

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get a structured representation of the error for logging
   */
  toStructuredLog() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

/**
 * Planning-related errors
 */
export class PlannerError extends NanobrowserError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Planner] ${message}`, 'PLANNER_ERROR', context);
  }
}

export class PlanValidationError extends NanobrowserError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Plan Validation] ${message}`, 'PLAN_VALIDATION_ERROR', context);
  }
}

/**
 * Execution-related errors
 */
export class ExecutionError extends NanobrowserError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Execution] ${message}`, 'EXECUTION_ERROR', context);
  }
}

export class NavigationError extends NanobrowserError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Navigation] ${message}`, 'NAVIGATION_ERROR', context);
  }
}

export class ActionExecutionError extends NanobrowserError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Action] ${message}`, 'ACTION_EXECUTION_ERROR', context);
  }
}

/**
 * Browser integration errors
 */
export class BrowserError extends NanobrowserError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Browser] ${message}`, 'BROWSER_ERROR', context);
  }
}

export class TabAccessError extends NanobrowserError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Tab Access] ${message}`, 'TAB_ACCESS_ERROR', context);
  }
}

/**
 * Configuration and validation errors
 */
export class ConfigurationError extends NanobrowserError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Configuration] ${message}`, 'CONFIGURATION_ERROR', context);
  }
}

export class ValidationError extends NanobrowserError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Validation] ${message}`, 'VALIDATION_ERROR', context);
  }
}

/**
 * LLM and external service errors
 */
export class LLMError extends NanobrowserError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[LLM] ${message}`, 'LLM_ERROR', context);
  }
}

export class ChatModelAuthError extends LLMError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Auth] ${message}`, { ...context, code: 'CHAT_MODEL_AUTH_ERROR' });
  }
}

export class ChatModelForbiddenError extends LLMError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Forbidden] ${message}`, { ...context, code: 'CHAT_MODEL_FORBIDDEN_ERROR' });
  }
}

export class RequestCancelledError extends LLMError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Cancelled] ${message}`, { ...context, code: 'REQUEST_CANCELLED_ERROR' });
  }
}

/**
 * Error handler utility class
 */
export class ErrorHandler {
  /**
   * Handle and log an error appropriately based on its type
   */
  static handle(error: unknown, logger?: { error: (msg: string, ...args: any[]) => void }): NanobrowserError {
    if (error instanceof NanobrowserError) {
      logger?.error('Structured error:', error.toStructuredLog());
      return error;
    }

    if (error instanceof Error) {
      const wrappedError = new ExecutionError(error.message, {
        originalStack: error.stack,
        originalName: error.name,
      });
      logger?.error('Wrapped error:', wrappedError.toStructuredLog());
      return wrappedError;
    }

    const unknownError = new ExecutionError('Unknown error occurred', {
      originalError: String(error),
    });
    logger?.error('Unknown error:', unknownError.toStructuredLog());
    return unknownError;
  }

  /**
   * Check if an error is recoverable (should retry)
   */
  static isRecoverable(error: NanobrowserError): boolean {
    const nonRecoverableCodes = [
      'CHAT_MODEL_AUTH_ERROR',
      'CHAT_MODEL_FORBIDDEN_ERROR',
      'CONFIGURATION_ERROR',
      'PLAN_VALIDATION_ERROR',
    ];

    return !nonRecoverableCodes.includes(error.code);
  }

  /**
   * Get a user-friendly error message
   */
  static getUserMessage(error: NanobrowserError): string {
    switch (error.code) {
      case 'CHAT_MODEL_AUTH_ERROR':
        return 'Authentication failed. Please check your API credentials.';
      case 'CHAT_MODEL_FORBIDDEN_ERROR':
        return 'Access denied. Please verify your permissions.';
      case 'TAB_ACCESS_ERROR':
        return 'Unable to access the current tab. Please ensure the page is loaded.';
      case 'PLANNER_ERROR':
        return 'Planning failed. Please try rephrasing your request.';
      case 'NAVIGATION_ERROR':
        return 'Navigation failed. The page may have changed or be inaccessible.';
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }
}
