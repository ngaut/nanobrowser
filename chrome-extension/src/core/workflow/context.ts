import type { AgentConfig } from '@src/shared/config';
import type { ActionResult, AgentStepInfo, PlannerOutput } from '@src/shared/types';
import type BrowserContext from '@src/background/browser/context';
import type MessageManager from '@src/background/agent/messages/service';
import type { EventManager } from '@src/background/agent/event/manager';
import {
  type Actors,
  type ExecutionState,
  AgentEvent,
  type EventData,
  EventType,
} from '@src/background/agent/event/types';

/**
 * Centralized context for workflow execution
 * Replaces the scattered AgentContext with better organization
 */
export class WorkflowContext {
  // Core identifiers
  readonly taskId: string;
  readonly controller: AbortController;

  // External dependencies
  readonly browserContext: BrowserContext;
  readonly messageManager: MessageManager;
  readonly eventManager: EventManager;
  readonly config: AgentConfig;

  // Execution state
  paused: boolean = false;
  stopped: boolean = false;
  nSteps: number = 0;
  stepInfo: AgentStepInfo | null = null;

  // Error tracking
  consecutiveFailures: number = 0;
  consecutiveValidatorFailures: number = 0;

  // Action and plan management
  actionResults: ActionResult[] = [];
  stateMessageAdded: boolean = false;

  // Planning state
  planAwaitingUserResponse: boolean = false;
  pendingPlan: PlannerOutput | null = null;
  currentWebTask: boolean | undefined = undefined;
  currentTaskIsDone: boolean = false;

  constructor(
    taskId: string,
    browserContext: BrowserContext,
    messageManager: MessageManager,
    eventManager: EventManager,
    config: AgentConfig,
  ) {
    this.taskId = taskId;
    this.controller = new AbortController();
    this.browserContext = browserContext;
    this.messageManager = messageManager;
    this.eventManager = eventManager;
    this.config = config;
  }

  /**
   * Emit an event with structured data
   */
  async emitEvent(
    actor: Actors,
    state: ExecutionState,
    eventDetails: string,
    eventType?: EventType,
    detailsObject?: Record<string, unknown>,
  ): Promise<void> {
    const eventData: EventData = {
      taskId: this.taskId,
      step: this.nSteps,
      maxSteps: this.config.maxSteps,
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

  /**
   * Pause execution
   */
  async pause(): Promise<void> {
    this.paused = true;
  }

  /**
   * Resume execution
   */
  async resume(): Promise<void> {
    this.paused = false;
  }

  /**
   * Stop execution and abort any ongoing operations
   */
  async stop(): Promise<void> {
    this.stopped = true;
    setTimeout(() => this.controller.abort(), 300);
  }

  /**
   * Reset failure counters (called on successful step)
   */
  resetFailureCounters(): void {
    this.consecutiveFailures = 0;
    this.consecutiveValidatorFailures = 0;
  }

  /**
   * Record a failure and check if we should stop
   */
  recordFailure(): boolean {
    this.consecutiveFailures++;
    return this.consecutiveFailures >= this.config.maxFailures;
  }

  /**
   * Record a validator failure and check if we should stop
   */
  recordValidatorFailure(): boolean {
    this.consecutiveValidatorFailures++;
    return this.consecutiveValidatorFailures >= this.config.maxValidatorFailures;
  }

  /**
   * Update step information
   */
  updateStepInfo(): void {
    this.stepInfo = {
      stepNumber: this.nSteps,
      maxSteps: this.config.maxSteps,
    };
  }

  /**
   * Check if execution should continue
   */
  shouldContinue(): boolean {
    return !this.stopped && !this.paused && this.nSteps < this.config.maxSteps;
  }

  /**
   * Check if it's time for planning
   */
  shouldPlan(validatorFailed: boolean = false): boolean {
    return this.nSteps % this.config.planningInterval === 0 || validatorFailed;
  }

  /**
   * Get execution summary for logging/debugging
   */
  getExecutionSummary(): {
    taskId: string;
    currentStep: number;
    maxSteps: number;
    status: 'running' | 'paused' | 'stopped';
    failures: number;
    validatorFailures: number;
  } {
    return {
      taskId: this.taskId,
      currentStep: this.nSteps,
      maxSteps: this.config.maxSteps,
      status: this.stopped ? 'stopped' : this.paused ? 'paused' : 'running',
      failures: this.consecutiveFailures,
      validatorFailures: this.consecutiveValidatorFailures,
    };
  }
}
