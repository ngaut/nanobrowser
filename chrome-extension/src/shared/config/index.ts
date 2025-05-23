export interface AgentConfig {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  maxValidatorFailures: number;
  retryDelay: number;
  maxInputTokens: number;
  maxErrorLength: number;
  useVision: boolean;
  useVisionForPlanner: boolean;
  validateOutput: boolean;
  includeAttributes: string[];
  planningInterval: number;
  // Smart check-in settings
  enableUserCheckIns: boolean;
  checkInAfterSteps: number;
  checkInTimeoutSeconds: number;
}

export interface BrowserConfig {
  highlightElements: boolean;
  maxTabsOpen: number;
  defaultTimeout: number;
}

export interface DevelopmentConfig {
  debugMode: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enableDevTools: boolean;
}

export interface AppConfig {
  agent: AgentConfig;
  browser: BrowserConfig;
  development: DevelopmentConfig;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxSteps: 100,
  maxActionsPerStep: 10,
  maxFailures: 3,
  maxValidatorFailures: 3,
  retryDelay: 10,
  maxInputTokens: 128000,
  maxErrorLength: 400,
  useVision: false,
  useVisionForPlanner: true,
  validateOutput: true,
  includeAttributes: [
    'title',
    'type',
    'name',
    'role',
    'href',
    'tabindex',
    'aria-label',
    'placeholder',
    'value',
    'alt',
    'aria-expanded',
    'data-date-format',
  ],
  planningInterval: 3,
  enableUserCheckIns: false,
  checkInAfterSteps: 5,
  checkInTimeoutSeconds: 10,
};

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  highlightElements: true,
  maxTabsOpen: 5,
  defaultTimeout: 30000,
};

// Safe access to import.meta.env.DEV with fallback
function getDevMode(): boolean {
  try {
    return typeof import.meta !== 'undefined' && import.meta.env !== undefined && import.meta.env.DEV === true;
  } catch (error) {
    // Fallback to NODE_ENV if import.meta is not available (service worker context)
    return typeof process !== 'undefined' && process.env !== undefined && process.env.NODE_ENV === 'development';
  }
}

export const DEFAULT_DEVELOPMENT_CONFIG: DevelopmentConfig = {
  debugMode: getDevMode(),
  logLevel: 'info',
  enableDevTools: true,
};

export const APP_CONFIG: AppConfig = {
  agent: DEFAULT_AGENT_CONFIG,
  browser: DEFAULT_BROWSER_CONFIG,
  development: DEFAULT_DEVELOPMENT_CONFIG,
};

/**
 * Get the current application configuration
 * This allows for future dynamic configuration loading
 */
export function getAppConfig(): AppConfig {
  return APP_CONFIG;
}

/**
 * Override agent configuration for specific use cases
 */
export function createAgentConfig(overrides: Partial<AgentConfig>): AgentConfig {
  return { ...DEFAULT_AGENT_CONFIG, ...overrides };
}
