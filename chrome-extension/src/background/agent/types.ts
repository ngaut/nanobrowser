import { z } from 'zod';
import type BrowserContext from '../browser/context';
import type MessageManager from './messages/service';
import type { EventManager } from './event/manager';
import { type Actors, type ExecutionState, AgentEvent, type EventData, EventType } from './event/types';
import { ValidationError } from '@src/shared/types/errors';
import { createLogger } from '@src/infrastructure/monitoring/logger';

const logger = createLogger('AgentTypes');

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
  // Smart check-in settings
  enableUserCheckIns: boolean;
  checkInAfterSteps: number;
  checkInTimeoutSeconds: number;
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
  enableUserCheckIns: false,
  checkInAfterSteps: 0,
  checkInTimeoutSeconds: 0,
};

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
  planAwaitingUserResponse: boolean;
  pendingPlan: PlannerOutput | null;
  currentWebTask: boolean | undefined;
  currentTaskIsDone: boolean;

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
    this.planAwaitingUserResponse = false;
    this.pendingPlan = null;
    this.currentWebTask = undefined;
    this.currentTaskIsDone = false;
  }

  async emitEvent(
    actor: Actors,
    state: ExecutionState,
    eventDetails: string,
    eventType?: EventType,
    detailsObject?: Record<string, unknown>,
  ) {
    const eventData: EventData = {
      taskId: this.taskId,
      step: this.nSteps,
      maxSteps: this.options.maxSteps,
      details: eventDetails,
      detailsObject,
    };
    // Conditionally add output to the event data if it's provided
    if (detailsObject !== undefined) {
      (eventData as any).output = detailsObject;
    }
    const event = new AgentEvent(actor, state, eventData, Date.now(), eventType);
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
}

export class ActionResult {
  isDone: boolean;
  extractedContent: string | null;
  error: string | null;
  includeInMemory: boolean;

  constructor(params: ActionResultParams = {}) {
    this.isDone = params.isDone ?? false;
    this.extractedContent = params.extractedContent ?? null;
    this.error = params.error ?? null;
    this.includeInMemory = params.includeInMemory ?? false;
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

// Planner output schema and types
export const plannerOutputSchema = z.object({
  understanding: z.string().default(''),
  observation: z.string().default(''),
  challenges: z.string().default(''),
  done: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new ValidationError('Invalid boolean string');
    }),
  ]),
  clarification_questions: z.union([z.string(), z.array(z.string())]).default(''),
  detailed_steps: z.union([z.string(), z.array(z.string())]).default(''),
  reasoning: z.string().default(''),
  web_task: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new ValidationError('Invalid boolean string');
    }),
  ]),
  answer: z.string().default(''),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export interface PlannerWaitingUserResponse {
  status: 'awaiting_user_plan_response';
  planProposed: PlannerOutput;
}

// Schema for interpreting user responses to plan proposals
export const userResponseInterpretationSchema = z.object({
  intent: z.enum(['confirmed', 'rejected', 'clarification', 'modification']),
  reasoning: z.string(),
  action: z.enum(['proceed', 'stop', 'incorporate_feedback', 'ask_for_explicit_confirmation']),
});

export type UserResponseInterpretation = z.infer<typeof userResponseInterpretationSchema>;
