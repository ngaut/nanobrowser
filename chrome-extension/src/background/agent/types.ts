import { z } from 'zod';
import type BrowserContext from '../browser/context';
import type MessageManager from './messages/service';
import type { EventManager } from './event/manager';
import { type Actors, type ExecutionState, AgentEvent, type EventData } from './event/types';

export interface AgentOptions {
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
}

export const DEFAULT_AGENT_OPTIONS: AgentOptions = {
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
};

// Current page information interface for sharing across agents
export interface CurrentPageInfo {
  title: string;
  url: string;
  tabId: number;
  lastUpdated: string;
}

export class AgentContext {
  controller: AbortController;
  taskId: string;
  browserContext: BrowserContext;
  messageManager: MessageManager;
  eventManager: EventManager;
  options: AgentOptions;
  paused: boolean;
  stopped: boolean;
  consecutiveFailures: number;
  consecutiveValidatorFailures: number;
  nSteps: number;
  stepInfo: AgentStepInfo | null;
  actionResults: ActionResult[];
  stateMessageAdded: boolean;

  // Shared current page information for all agents
  currentPage: CurrentPageInfo | null;

  // Execution timing
  executionStartTime: string;

  constructor(
    taskId: string,
    browserContext: BrowserContext,
    messageManager: MessageManager,
    eventManager: EventManager,
    options: Partial<AgentOptions>,
  ) {
    this.controller = new AbortController();
    this.taskId = taskId;
    this.browserContext = browserContext;
    this.messageManager = messageManager;
    this.eventManager = eventManager;
    this.options = { ...DEFAULT_AGENT_OPTIONS, ...options };

    this.paused = false;
    this.stopped = false;
    this.nSteps = 0;
    this.consecutiveFailures = 0;
    this.consecutiveValidatorFailures = 0;
    this.stepInfo = null;
    this.actionResults = [];
    this.stateMessageAdded = false;
    this.currentPage = null;
    this.executionStartTime = new Date().toISOString();
  }

  /**
   * Update the current page information in the context
   * This should be called whenever page navigation or updates occur
   */
  async updateCurrentPageInfo(): Promise<void> {
    try {
      const browserState = await this.browserContext.getState(false, false);
      this.currentPage = {
        title: browserState.title || 'Unknown Page',
        url: browserState.url || 'Unknown URL',
        tabId: browserState.tabId,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      console.warn('Failed to update current page info:', error);
      // Keep existing page info if update fails
    }
  }

  /**
   * Get current page information, updating it if not available or stale
   */
  async getCurrentPageInfo(): Promise<CurrentPageInfo> {
    if (!this.currentPage) {
      await this.updateCurrentPageInfo();
    }
    return (
      this.currentPage || {
        title: 'Unknown Page',
        url: 'Unknown URL',
        tabId: -1,
        lastUpdated: new Date().toISOString(),
      }
    );
  }

  async emitEvent(
    actor: Actors,
    state: ExecutionState,
    eventDetails: string,
    detailsObject?: Record<string, unknown>,
    output?: unknown,
  ) {
    const eventData: EventData = {
      taskId: this.taskId,
      step: this.nSteps,
      maxSteps: this.options.maxSteps,
      details: eventDetails,
      detailsObject,
    };
    // Conditionally add output to the event data if it's provided
    if (output !== undefined) {
      (eventData as any).output = output;
    }
    const event = new AgentEvent(actor, state, eventData);
    await this.eventManager.emit(event);
  }

  async pause() {
    this.paused = true;
  }

  async resume() {
    this.paused = false;
  }

  async stop() {
    this.stopped = true;
    setTimeout(() => this.controller.abort(), 300);
  }
}

export class AgentStepInfo {
  stepNumber: number;
  maxSteps: number;

  constructor(params: { stepNumber: number; maxSteps: number }) {
    this.stepNumber = params.stepNumber;
    this.maxSteps = params.maxSteps;
  }
}

interface ActionResultParams {
  isDone?: boolean;
  extractedContent?: string | null;
  error?: string | null;
  includeInMemory?: boolean;
  sourceURL?: string;
}

export class ActionResult {
  isDone: boolean;
  extractedContent: string | null;
  error: string | null;
  includeInMemory: boolean;
  sourceURL: string | null;

  constructor(params: ActionResultParams = {}) {
    this.isDone = params.isDone ?? false;
    this.extractedContent = params.extractedContent ?? null;
    this.error = params.error ?? null;
    this.includeInMemory = params.includeInMemory ?? false;
    this.sourceURL = params.sourceURL ?? null;
  }
}

export type WrappedActionResult = ActionResult & {
  toolCallId: string;
};

export const agentBrainSchema = z.object({
  evaluation_previous_goal: z.string(),
  memory: z.string(),
  next_goal: z.string(),
});

export type AgentBrain = z.infer<typeof agentBrainSchema>;

// Make AgentOutput generic with Zod schema
export interface AgentOutput<T = unknown> {
  /**
   * The unique identifier for the agent
   */
  id: string;

  /**
   * The result of the agent's step
   */
  result?: T;
  /**
   * The error that occurred during the agent's action
   */
  error?: string;
}
