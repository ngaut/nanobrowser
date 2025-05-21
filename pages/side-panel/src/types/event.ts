import type { Actors } from '@extension/storage';

export enum EventType {
  /**
   * Type of events that can be subscribed to.
   *
   * For now, only execution events are supported.
   */
  EXECUTION = 'execution',
}

export enum ExecutionState {
  /**
   * States representing different phases in the execution lifecycle.
   *
   * Format: <SCOPE>.<STATUS>
   * Scopes: task, step, act
   * Statuses: start, ok, fail, cancel
   *
   * Examples:
   *     TASK_OK = "task.ok"  // Task completed successfully
   *     STEP_FAIL = "step.fail"  // Step failed
   *     ACT_START = "act.start"  // Action started
   */
  // Task level states
  TASK_START = 'task.start',
  TASK_OK = 'task.ok',
  TASK_FAIL = 'task.fail',
  TASK_PAUSE = 'task.pause',
  TASK_RESUME = 'task.resume',
  TASK_CANCEL = 'task.cancel',

  // Step level states
  STEP_START = 'step.start',
  STEP_OK = 'step.ok',
  STEP_FAIL = 'step.fail',
  STEP_CANCEL = 'step.cancel',

  // Action/Tool level states
  ACT_START = 'act.start',
  ACT_OK = 'act.ok',
  ACT_FAIL = 'act.fail',
}

export interface EventData {
  /** Data associated with an event */
  taskId: string;
  /** step is the step number of the task where the event occurred */
  step: number;
  /** max_steps is the maximum number of steps in the task */
  maxSteps: number;
  /** details is the content of the event */
  details: string;
}

export interface EventMetadata {
  source?: string;
  target?: string;
  parameters?: Record<string, unknown>;
  errorDetails?: {
    code?: string;
    message?: string;
    stack?: string;
  };
}

export type EventStatus = 'success' | 'error' | 'warning' | 'info';

export interface EnhancedEventData extends EventData {
  duration?: number; // Event duration in milliseconds
  status: EventStatus;
  metadata?: EventMetadata;
  relatedEvents?: string[]; // IDs of related events
  tags?: string[]; // For event categorization
}

export class AgentEvent {
  /**
   * Represents a state change event in the task execution system.
   * Each event has a type, a specific state that changed,
   * the actor that triggered the change, and associated data.
   */
  constructor(
    public actor: Actors,
    public state: ExecutionState,
    public data: EnhancedEventData,
    public timestamp: number = Date.now(),
    public type: EventType = EventType.EXECUTION,
  ) {}

  // Helper method to get event status based on state
  getEventStatus(): EventStatus {
    switch (this.state) {
      case ExecutionState.TASK_OK:
      case ExecutionState.STEP_OK:
      case ExecutionState.ACT_OK:
        return 'success';
      case ExecutionState.TASK_FAIL:
      case ExecutionState.STEP_FAIL:
      case ExecutionState.ACT_FAIL:
        return 'error';
      case ExecutionState.TASK_PAUSE:
      case ExecutionState.TASK_RESUME:
        return 'warning';
      default:
        return 'info';
    }
  }

  // Helper method to get event duration
  getDuration(): number | undefined {
    // This will be populated when the event is completed
    return this.data.duration;
  }

  // Helper method to get formatted duration
  getFormattedDuration(): string | undefined {
    const duration = this.getDuration();
    if (!duration) return undefined;

    if (duration < 1000) {
      return `${duration}ms`;
    }
    const seconds = Math.floor(duration / 1000);
    const milliseconds = duration % 1000;
    return `${seconds}s ${milliseconds}ms`;
  }
}

// The type of callback for event subscribers
export type EventCallback = (event: AgentEvent) => Promise<void>;
