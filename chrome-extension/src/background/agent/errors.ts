export class RequestCancelledError extends Error {
  constructor(message: string = 'Request was cancelled') {
    super(message);
    this.name = 'RequestCancelledError';
  }
}

export class UnableToParseOutputError extends Error {
  constructor(message: string = 'Unable to parse LLM output') {
    super(message);
    this.name = 'UnableToParseOutputError';
  }
}

export function isAbortedError(error: any): error is DOMException {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function isAuthenticationError(error: any): boolean {
  // Implement actual check based on your error types/API responses
  return (
    error?.response?.status === 401 ||
    error?.status === 401 ||
    error?.message?.includes('API key') ||
    error?.name === 'ChatModelAuthError'
  );
}

export function isForbiddenError(error: any): boolean {
  return error?.response?.status === 403 || error?.status === 403 || error?.name === 'ChatModelForbiddenError';
}

export const LLM_FORBIDDEN_ERROR_MESSAGE =
  'The LLM API request was forbidden. This might be due to an invalid API key, insufficient credits, or rate limiting. Please check your API key and plan.';

export class ChatModelAuthError extends Error {
  constructor(message: string = 'Authentication error with Chat Model API.') {
    super(message);
    this.name = 'ChatModelAuthError';
  }
}

export class ChatModelForbiddenError extends Error {
  constructor(message: string = LLM_FORBIDDEN_ERROR_MESSAGE) {
    super(message);
    this.name = 'ChatModelForbiddenError';
  }
}
