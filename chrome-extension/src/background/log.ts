/// <reference types="vite/client" />

type LogLevel = 'debug' | 'info' | 'warning' | 'error';

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warning: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  group: (label: string) => void;
  groupEnd: () => void;
  // Helper for detailed object logging
  infoDetailed: (message: string, obj: unknown) => void;
}

const createLogger = (namespace: string): Logger => {
  const prefix = `[${namespace}]`;

  return {
    debug: (...args: unknown[]) => {
      if (import.meta.env.DEV) {
        console.debug(prefix, ...args);
      }
    },
    info: (...args: unknown[]) => console.info(prefix, ...args),
    warning: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
    group: (label: string) => console.group(`${prefix} ${label}`),
    groupEnd: () => console.groupEnd(),
    // Helper for detailed object logging
    infoDetailed: (message: string, obj: unknown) => {
      try {
        const serialized = typeof obj === 'object' && obj !== null ? JSON.stringify(obj, null, 2) : String(obj);
        console.info(prefix, message, '\n' + serialized);
      } catch (error) {
        // If JSON.stringify fails (circular references, etc.), fall back to regular logging
        console.info(prefix, message, obj);
      }
    },
  };
};

// Create default logger
const logger = createLogger('Agent');

export type { Logger, LogLevel };
export { createLogger, logger };
