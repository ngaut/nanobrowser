import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, StructuredLogger } from '../logger';
import type { LogContext } from '../logger';

describe('StructuredLogger', () => {
  let consoleSpy: {
    info: ReturnType<typeof vi.spyOn>;
    debug: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
    group: ReturnType<typeof vi.spyOn>;
    groupEnd: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    // Spy on console methods
    consoleSpy = {
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      group: vi.spyOn(console, 'group').mockImplementation(() => {}),
      groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createLogger', () => {
    it('should create a logger instance with correct component name', () => {
      const logger = createLogger('TestComponent');
      expect(logger).toBeInstanceOf(StructuredLogger);
    });

    it('should create different instances for different components', () => {
      const logger1 = createLogger('Component1');
      const logger2 = createLogger('Component2');
      expect(logger1).not.toBe(logger2);
    });
  });

  describe('Basic logging methods', () => {
    let logger: StructuredLogger;

    beforeEach(() => {
      logger = createLogger('TestLogger');
    });

    it('should log info messages', () => {
      logger.info('Test info message');
      expect(consoleSpy.info).toHaveBeenCalled();

      const call = consoleSpy.info.mock.calls[0][0];
      expect(call).toContain('[INFO]');
      expect(call).toContain('[TestLogger]');
      expect(call).toContain('Test info message');
    });

    it('should log debug messages', () => {
      logger.debug('Test debug message');
      expect(consoleSpy.debug).toHaveBeenCalled();

      const call = consoleSpy.debug.mock.calls[0][0];
      expect(call).toContain('[DEBUG]');
      expect(call).toContain('[TestLogger]');
      expect(call).toContain('Test debug message');
    });

    it('should log warning messages', () => {
      logger.warn('Test warning message');
      expect(consoleSpy.warn).toHaveBeenCalled();

      const call = consoleSpy.warn.mock.calls[0][0];
      expect(call).toContain('[WARN]');
      expect(call).toContain('[TestLogger]');
      expect(call).toContain('Test warning message');
    });

    it('should log error messages without error object', () => {
      logger.error('Test error message');
      expect(consoleSpy.error).toHaveBeenCalled();

      const call = consoleSpy.error.mock.calls[0][0];
      expect(call).toContain('[ERROR]');
      expect(call).toContain('[TestLogger]');
      expect(call).toContain('Test error message');
    });
  });

  describe('Context logging', () => {
    let logger: StructuredLogger;

    beforeEach(() => {
      logger = createLogger('ContextLogger');
    });

    it('should include context in log messages', () => {
      const context: LogContext = {
        taskId: 'task-123',
        step: 5,
        action: 'click',
      };

      logger.info('Test with context', context);
      expect(consoleSpy.info).toHaveBeenCalled();

      const call = consoleSpy.info.mock.calls[0][0];
      expect(call).toContain('Test with context');
      expect(call).toContain('task-123');
    });

    it('should handle empty context', () => {
      logger.info('Test without context');
      expect(consoleSpy.info).toHaveBeenCalled();

      const call = consoleSpy.info.mock.calls[0][0];
      expect(call).toContain('Test without context');
    });
  });

  describe('Error logging', () => {
    let logger: StructuredLogger;

    beforeEach(() => {
      logger = createLogger('ErrorLogger');
    });

    it('should log errors with Error objects', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n  at test.js:1:1';

      logger.error('Error occurred', error);
      expect(consoleSpy.error).toHaveBeenCalled();

      // Should log both message and error info
      const calls = consoleSpy.error.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });

    it('should handle custom error types', () => {
      class CustomError extends Error {
        code = 'CUSTOM_ERR';
        context = { additional: 'info' };
      }

      const error = new CustomError('Custom error message');
      logger.error('Custom error occurred', error);
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should handle errors with context', () => {
      const error = new Error('Context error');
      const context: LogContext = {
        taskId: 'task-456',
        component: 'Agent',
      };

      logger.error('Error with context', error, context);
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe('Specialized logging methods', () => {
    let logger: StructuredLogger;

    beforeEach(() => {
      logger = createLogger('SpecialLogger');
    });

    it('should log planning activities', () => {
      logger.plan('Creating plan', { taskId: 'task-789', step: 1 });
      expect(consoleSpy.info).toHaveBeenCalled();

      const call = consoleSpy.info.mock.calls[0][0];
      expect(call).toContain('[Planning]');
      expect(call).toContain('Creating plan');
    });

    it('should log execution activities', () => {
      logger.execution('Executing action', { action: 'click', elementIndex: 42 });
      expect(consoleSpy.info).toHaveBeenCalled();

      const call = consoleSpy.info.mock.calls[0][0];
      expect(call).toContain('[Execution]');
      expect(call).toContain('Executing action');
    });

    it('should log browser activities', () => {
      logger.browser('Page loaded', { url: 'https://example.com' });
      expect(consoleSpy.info).toHaveBeenCalled();

      const call = consoleSpy.info.mock.calls[0][0];
      expect(call).toContain('[Browser]');
      expect(call).toContain('Page loaded');
    });

    it('should log navigation activities', () => {
      logger.navigation('Navigating to URL', { url: 'https://test.com' });
      expect(consoleSpy.info).toHaveBeenCalled();

      const call = consoleSpy.info.mock.calls[0][0];
      expect(call).toContain('[Navigation]');
      expect(call).toContain('Navigating to URL');
    });

    it('should log performance metrics', () => {
      logger.performance('Page load time', 1500, { url: 'https://example.com' });
      expect(consoleSpy.info).toHaveBeenCalled();

      const call = consoleSpy.info.mock.calls[0][0];
      expect(call).toContain('[Performance]');
      expect(call).toContain('Page load time: 1500ms');
    });
  });

  describe('Import path compatibility', () => {
    it('should work when imported from infrastructure path', async () => {
      // This tests that our fixed import paths work correctly
      const { createLogger: infrastructureLogger } = await import('../logger');
      const logger = infrastructureLogger('ImportTest');

      expect(logger).toBeInstanceOf(StructuredLogger);

      // Test that it actually logs
      logger.info('Import test message');
      expect(consoleSpy.info).toHaveBeenCalled();
    });
  });

  describe('Legacy compatibility', () => {
    let logger: StructuredLogger;

    beforeEach(() => {
      logger = createLogger('LegacyTest');
    });

    it('should handle multiple parameters like old logger', () => {
      // Test the patterns we found in our codebase that use multiple parameters
      // These should not throw errors even if not optimal

      expect(() => {
        // @ts-expect-error - Testing legacy compatibility
        logger.info('Message with extra param', 'extra param');
      }).not.toThrow();

      expect(() => {
        // @ts-expect-error - Testing legacy compatibility
        logger.error('Error with string', 'error string');
      }).not.toThrow();
    });
  });
});
