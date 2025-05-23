import { describe, it, expect } from 'vitest';
import {
  NanobrowserError,
  ConfigurationError,
  ExecutionError,
  BrowserError,
  ValidationError,
  NavigationError,
  ActionExecutionError,
} from '../errors';

describe('Structured Error System', () => {
  describe('NanobrowserError (Base Class)', () => {
    it('should create a basic error with message', () => {
      const error = new NanobrowserError('Test error');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(NanobrowserError);
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('NanobrowserError');
    });

    it('should create error with code and context', () => {
      const context = { taskId: 'task-123', step: 5 };
      const error = new NanobrowserError('Test error', 'TEST_ERROR', context);

      expect(error.code).toBe('TEST_ERROR');
      expect(error.context).toEqual(context);
    });

    it('should create error with nested cause', () => {
      const cause = new Error('Original error');
      const error = new NanobrowserError('Wrapper error', undefined, undefined, cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe('ConfigurationError', () => {
    it('should create configuration error for missing API keys', () => {
      const error = new ConfigurationError('Missing API key for OpenAI');

      expect(error).toBeInstanceOf(NanobrowserError);
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error.name).toBe('ConfigurationError');
      expect(error.message).toBe('Missing API key for OpenAI');
    });

    it('should handle provider configuration errors', () => {
      const context = { provider: 'openai', model: 'gpt-4' };
      const error = new ConfigurationError('Provider openai not found in settings', 'PROVIDER_NOT_FOUND', context);

      expect(error.code).toBe('PROVIDER_NOT_FOUND');
      expect(error.context).toEqual(context);
    });

    it('should handle model configuration errors', () => {
      const error = new ConfigurationError('Please choose a model for the navigator');

      expect(error.message).toContain('model for the navigator');
    });
  });

  describe('ExecutionError', () => {
    it('should create execution error for task failures', () => {
      const error = new ExecutionError('Task execution failed');

      expect(error).toBeInstanceOf(NanobrowserError);
      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.name).toBe('ExecutionError');
    });

    it('should handle task not found errors', () => {
      const taskId = 'non-existent-task';
      const error = new ExecutionError(`Task not found: ${taskId}`, 'TASK_NOT_FOUND', { taskId });

      expect(error.code).toBe('TASK_NOT_FOUND');
      expect(error.context?.taskId).toBe(taskId);
    });

    it('should handle pipeline execution errors', () => {
      const context = { pipeline: 'agent-execution', step: 3 };
      const error = new ExecutionError('Pipeline execution failed', 'PIPELINE_ERROR', context);

      expect(error.context).toEqual(context);
    });
  });

  describe('BrowserError', () => {
    it('should create browser error for tab issues', () => {
      const error = new BrowserError('Tab ID is not available');

      expect(error).toBeInstanceOf(NanobrowserError);
      expect(error).toBeInstanceOf(BrowserError);
      expect(error.name).toBe('BrowserError');
    });

    it('should handle browser connection errors', () => {
      const context = { tabId: 123, url: 'https://example.com' };
      const error = new BrowserError('Failed to connect to browser tab', 'CONNECTION_FAILED', context);

      expect(error.code).toBe('CONNECTION_FAILED');
      expect(error.context).toEqual(context);
    });

    it('should handle puppeteer attachment errors', () => {
      const error = new BrowserError('Failed to attach puppeteer');

      expect(error.message).toContain('attach puppeteer');
    });
  });

  describe('ValidationError', () => {
    it('should create validation error for schema issues', () => {
      const error = new ValidationError('Invalid input schema');

      expect(error).toBeInstanceOf(NanobrowserError);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.name).toBe('ValidationError');
    });

    it('should handle DOM validation errors', () => {
      const context = { selector: '#invalid-element', expectedType: 'button' };
      const error = new ValidationError('Element validation failed', 'ELEMENT_VALIDATION_FAILED', context);

      expect(error.context).toEqual(context);
    });
  });

  describe('NavigationError', () => {
    it('should create navigation error for URL issues', () => {
      const error = new NavigationError('Navigation timeout');

      expect(error).toBeInstanceOf(NanobrowserError);
      expect(error).toBeInstanceOf(NavigationError);
      expect(error.name).toBe('NavigationError');
    });

    it('should handle URL blocked errors', () => {
      const context = { url: 'https://blocked-site.com' };
      const error = new NavigationError('URL not allowed by firewall', 'URL_BLOCKED', context);

      expect(error.code).toBe('URL_BLOCKED');
      expect(error.context).toEqual(context);
    });
  });

  describe('ActionExecutionError', () => {
    it('should create action execution error', () => {
      const error = new ActionExecutionError('Click action failed');

      expect(error).toBeInstanceOf(NanobrowserError);
      expect(error).toBeInstanceOf(ActionExecutionError);
      expect(error.name).toBe('ActionExecutionError');
    });

    it('should handle element interaction errors', () => {
      const context = { action: 'click', elementIndex: 42, selector: 'button' };
      const error = new ActionExecutionError('Element not clickable', 'ELEMENT_NOT_CLICKABLE', context);

      expect(error.context).toEqual(context);
    });
  });

  describe('Error Recovery Information', () => {
    it('should provide error recovery context', () => {
      const recoveryContext = {
        canRetry: true,
        suggestedAction: 'Check API key configuration',
        retryAfter: 5000,
      };

      const error = new ConfigurationError('API authentication failed', 'AUTH_FAILED', recoveryContext);

      expect(error.context).toEqual(recoveryContext);
    });

    it('should chain errors for debugging', () => {
      const originalError = new Error('Network timeout');
      const wrappedError = new BrowserError(
        'Failed to load page',
        'PAGE_LOAD_FAILED',
        { timeout: 30000 },
        originalError,
      );

      expect(wrappedError.cause).toBe(originalError);
      expect(wrappedError.message).toBe('Failed to load page');
    });
  });

  describe('Error Pattern Compatibility', () => {
    it('should replace generic Error patterns', () => {
      // Test patterns that we used to have as generic Error throws

      // Old: throw new Error('Task not found')
      // New: throw new ExecutionError('Task not found', 'TASK_NOT_FOUND', { taskId })
      const executionError = new ExecutionError('Task not found: task-123', 'TASK_NOT_FOUND', { taskId: 'task-123' });

      expect(executionError).toBeInstanceOf(Error);
      expect(executionError.code).toBe('TASK_NOT_FOUND');

      // Old: throw new Error('Provider not found')
      // New: throw new ConfigurationError('Provider not found', 'PROVIDER_NOT_FOUND', { provider })
      const configError = new ConfigurationError('Provider openai not found', 'PROVIDER_NOT_FOUND', {
        provider: 'openai',
      });

      expect(configError).toBeInstanceOf(Error);
      expect(configError.code).toBe('PROVIDER_NOT_FOUND');
    });

    it('should maintain Error instanceof checks', () => {
      const errors = [
        new ConfigurationError('Config error'),
        new ExecutionError('Execution error'),
        new BrowserError('Browser error'),
        new ValidationError('Validation error'),
        new NavigationError('Navigation error'),
        new ActionExecutionError('Action error'),
      ];

      errors.forEach(error => {
        expect(error instanceof Error).toBe(true);
        expect(error instanceof NanobrowserError).toBe(true);
        expect(error.name).toBeTruthy();
        expect(error.message).toBeTruthy();
      });
    });
  });

  describe('Logging Integration', () => {
    it('should provide structured data for logger', () => {
      const error = new BrowserError('Page navigation failed', 'NAV_FAILED', {
        url: 'https://example.com',
        tabId: 123,
        timeout: 30000,
      });

      // Test that error has the properties structured logger expects
      expect(error.name).toBe('BrowserError');
      expect(error.message).toBe('Page navigation failed');
      expect(error.code).toBe('NAV_FAILED');
      expect(error.context?.url).toBe('https://example.com');
      expect(error.stack).toBeTruthy();
    });
  });
});
