// Safe config import with fallback for service worker context
let APP_CONFIG: any;
try {
  const { getAppConfig } = require('@src/shared/config');
  APP_CONFIG = getAppConfig();
} catch (error) {
  // Fallback config for service worker context
  APP_CONFIG = {
    development: {
      debugMode: false,
      logLevel: 'info',
      enableDevTools: false,
    },
  };
}

import type { NanobrowserError } from '@src/shared/types/errors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  taskId?: string;
  step?: number;
  component?: string;
  action?: string;
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

/**
 * Detect if we're running in a service worker context
 */
function isServiceWorkerContext(): boolean {
  return (
    typeof importScripts === 'function' && typeof navigator !== 'undefined' && navigator.serviceWorker !== undefined
  );
}

/**
 * Structured logger for better debugging and monitoring
 */
export class StructuredLogger {
  private readonly component: string;
  private readonly config = APP_CONFIG.development;
  private readonly isServiceWorker = isServiceWorkerContext();

  constructor(component: string) {
    this.component = component;
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Log a warning
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Log an error
   */
  error(message: string, error?: Error | NanobrowserError, context?: LogContext): void {
    const entry: StructuredLogEntry = {
      level: 'error',
      message,
      timestamp: Date.now(),
      context: { ...context, component: this.component },
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };

      // Add structured error info if available
      if ('code' in error && error.code) {
        entry.error.code = error.code as string;
      }
      if ('context' in error && error.context) {
        entry.context = { ...entry.context, errorContext: error.context };
      }
    }

    this.outputLog(entry);
  }

  /**
   * Log planning-related activities
   */
  plan(action: string, data: LogContext): void {
    this.log('info', `[Planning] ${action}`, { ...data, category: 'planning' });
  }

  /**
   * Log execution-related activities
   */
  execution(action: string, data: LogContext): void {
    this.log('info', `[Execution] ${action}`, { ...data, category: 'execution' });
  }

  /**
   * Log browser interaction activities
   */
  browser(action: string, data: LogContext): void {
    this.log('info', `[Browser] ${action}`, { ...data, category: 'browser' });
  }

  /**
   * Log navigation activities
   */
  navigation(action: string, data: LogContext): void {
    this.log('info', `[Navigation] ${action}`, { ...data, category: 'navigation' });
  }

  /**
   * Log performance metrics
   */
  performance(metric: string, value: number, context?: LogContext): void {
    this.log('info', `[Performance] ${metric}: ${value}ms`, {
      ...context,
      category: 'performance',
      metric,
      value,
    });
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: StructuredLogEntry = {
      level,
      message,
      timestamp: Date.now(),
      context: { ...context, component: this.component },
    };

    this.outputLog(entry);
  }

  /**
   * Check if we should log at this level
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };

    const configLevel = levels[this.config.logLevel];
    const messageLevel = levels[level];

    return messageLevel >= configLevel;
  }

  /**
   * Output the log entry
   */
  private outputLog(entry: StructuredLogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const prefix = `[${timestamp}] [${entry.level.toUpperCase()}] [${this.component}]`;

    // Use simple logging in service worker context
    if (this.isServiceWorker) {
      const contextStr = entry.context ? ` | ${JSON.stringify(entry.context)}` : '';
      const errorStr = entry.error ? ` | Error: ${entry.error.message}` : '';

      const logMethod = this.getConsoleMethod(entry.level);
      logMethod(`${prefix} ${entry.message}${contextStr}${errorStr}`);
      return;
    }

    if (this.config.debugMode) {
      // Structured output for development
      console.group(`${prefix} ${entry.message}`);
      if (entry.context) {
        console.log('Context:', entry.context);
      }
      if (entry.error) {
        console.error('Error:', entry.error);
      }
      console.groupEnd();
    } else {
      // Simple output for production
      const contextStr = entry.context ? ` | ${JSON.stringify(entry.context)}` : '';
      const errorStr = entry.error ? ` | Error: ${entry.error.message}` : '';

      const logMethod = this.getConsoleMethod(entry.level);
      logMethod(`${prefix} ${entry.message}${contextStr}${errorStr}`);
    }
  }

  /**
   * Get the appropriate console method for the log level
   */
  private getConsoleMethod(level: LogLevel): (...args: any[]) => void {
    switch (level) {
      case 'debug':
        return console.debug;
      case 'info':
        return console.info;
      case 'warn':
        return console.warn;
      case 'error':
        return console.error;
      default:
        return console.log;
    }
  }
}

/**
 * Create a logger for a specific component
 */
export function createLogger(component: string): StructuredLogger {
  return new StructuredLogger(component);
}

/**
 * Global logger instance for general use
 */
export const logger = new StructuredLogger('Global');
