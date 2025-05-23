import { createLogger } from '@src/infrastructure/monitoring/logger';
import { wrapUserRequest } from '@src/background/agent/messages/utils';
import { ExecutionError, ConfigurationError } from '@src/shared/types/errors';

const logger = createLogger('TaskManager');

/**
 * Task status enumeration
 */
export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Task information interface
 */
export interface TaskInfo {
  id: string;
  description: string;
  status: TaskStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failureReason?: string;
  parentTaskId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Task execution context
 */
export interface TaskContext {
  taskId: string;
  currentTask: TaskInfo;
  allTasks: TaskInfo[];
  executionState: {
    stepCount: number;
    maxSteps: number;
    isValidating: boolean;
    isPlanning: boolean;
  };
}

/**
 * Task events
 */
export interface TaskEvents {
  onTaskStart: (task: TaskInfo) => void;
  onTaskComplete: (task: TaskInfo) => void;
  onTaskFail: (task: TaskInfo, error: Error) => void;
  onFollowUpAdded: (task: TaskInfo, parentTask: TaskInfo) => void;
}

/**
 * Task manager for handling task lifecycle and follow-ups
 */
export class TaskManager {
  private tasks: Map<string, TaskInfo> = new Map();
  private currentTaskId: string | null = null;
  private taskQueue: string[] = [];
  private events: Partial<TaskEvents> = {};

  constructor() {
    logger.debug('Task manager initialized');
  }

  /**
   * Create a new task
   */
  createTask(description: string, parentTaskId?: string): TaskInfo {
    const taskId = this.generateTaskId();
    const task: TaskInfo = {
      id: taskId,
      description,
      status: TaskStatus.PENDING,
      createdAt: new Date(),
      parentTaskId,
    };

    this.tasks.set(taskId, task);
    this.taskQueue.push(taskId);

    logger.info('Task created', {
      taskId,
      description: description.substring(0, 100),
      parentTaskId,
      queueLength: this.taskQueue.length,
    });

    return task;
  }

  /**
   * Start executing a task
   */
  async start(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new ExecutionError(`Task not found: ${taskId}`);
    }

    if (task.status !== 'pending') {
      throw new ConfigurationError(`Task ${taskId} is not in pending status: ${task.status}`);
    }

    task.status = TaskStatus.IN_PROGRESS;
    task.startedAt = new Date();
    this.currentTaskId = taskId;

    logger.info('Task started', {
      taskId,
      description: task.description.substring(0, 100),
    });

    this.events.onTaskStart?.(task);
  }

  /**
   * Complete a task
   */
  async complete(taskId: string, result?: any): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new ExecutionError(`Task not found: ${taskId}`);
    }

    task.status = TaskStatus.COMPLETED;
    task.completedAt = new Date();

    if (this.currentTaskId === taskId) {
      this.currentTaskId = null;
    }

    logger.info('Task completed', {
      taskId,
      description: task.description.substring(0, 100),
      duration: task.completedAt.getTime() - (task.startedAt?.getTime() ?? task.createdAt.getTime()),
    });

    this.events.onTaskComplete?.(task);
  }

  /**
   * Fail a task
   */
  async fail(taskId: string, error: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new ExecutionError(`Task not found: ${taskId}`);
    }

    task.status = TaskStatus.FAILED;
    task.failureReason = error;
    task.completedAt = new Date();

    if (this.currentTaskId === taskId) {
      this.currentTaskId = null;
    }

    logger.error('Task failed', new Error(error), {
      taskId,
      description: task.description.substring(0, 100),
    });

    this.events.onTaskFail?.(task, new Error(error));
  }

  /**
   * Cancel a task
   */
  async cancel(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new ExecutionError(`Task not found: ${taskId}`);
    }

    task.status = TaskStatus.CANCELLED;
    task.completedAt = new Date();

    if (this.currentTaskId === taskId) {
      this.currentTaskId = null;
    }

    // Remove from queue if not started
    const queueIndex = this.taskQueue.indexOf(taskId);
    if (queueIndex !== -1) {
      this.taskQueue.splice(queueIndex, 1);
    }

    logger.info('Task cancelled', {
      taskId,
      description: task.description.substring(0, 100),
    });
  }

  /**
   * Add a follow-up task
   */
  async addFollowUp(description: string, metadata?: Record<string, unknown>): Promise<TaskInfo> {
    const currentTaskId = this.getCurrentTaskId();
    if (!currentTaskId) {
      throw new ExecutionError('No current task to add follow-up to');
    }

    const parentTask = this.tasks.get(currentTaskId);
    if (!parentTask) {
      throw new ExecutionError(`Parent task not found: ${currentTaskId}`);
    }

    const followUpTask = this.createTask(description, currentTaskId);
    if (metadata) {
      followUpTask.metadata = metadata;
    }

    logger.info('Follow-up task added', {
      followUpTaskId: followUpTask.id,
      parentTaskId: currentTaskId,
      description: description.substring(0, 100),
    });

    this.events.onFollowUpAdded?.(followUpTask, parentTask);
    return followUpTask;
  }

  /**
   * Get next task in queue
   */
  getNextTask(): TaskInfo | null {
    while (this.taskQueue.length > 0) {
      const taskId = this.taskQueue.shift()!;
      const task = this.tasks.get(taskId);

      if (task && task.status === TaskStatus.PENDING) {
        return task;
      }
    }
    return null;
  }

  /**
   * Get current task
   */
  getCurrentTask(): TaskInfo | null {
    if (!this.currentTaskId) {
      return null;
    }
    return this.tasks.get(this.currentTaskId) || null;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): TaskInfo[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: TaskStatus): TaskInfo[] {
    return this.getAllTasks().filter(task => task.status === status);
  }

  /**
   * Get task statistics
   */
  getStatistics(): {
    total: number;
    byStatus: Record<TaskStatus, number>;
    averageDuration: number;
    completionRate: number;
  } {
    const allTasks = this.getAllTasks();
    const byStatus = Object.values(TaskStatus).reduce(
      (acc, status) => ({
        ...acc,
        [status]: allTasks.filter(task => task.status === status).length,
      }),
      {} as Record<TaskStatus, number>,
    );

    const completedTasks = allTasks.filter(
      task => task.status === TaskStatus.COMPLETED && task.startedAt && task.completedAt,
    );

    const averageDuration =
      completedTasks.length > 0
        ? completedTasks.reduce((sum, task) => {
            const duration = task.completedAt!.getTime() - task.startedAt!.getTime();
            return sum + duration;
          }, 0) / completedTasks.length
        : 0;

    const completionRate = allTasks.length > 0 ? byStatus[TaskStatus.COMPLETED] / allTasks.length : 0;

    return {
      total: allTasks.length,
      byStatus,
      averageDuration,
      completionRate,
    };
  }

  /**
   * Create task context for current execution
   */
  createTaskContext(executionState: TaskContext['executionState']): TaskContext | null {
    const currentTask = this.getCurrentTask();
    if (!currentTask) {
      return null;
    }

    return {
      taskId: currentTask.id,
      currentTask,
      allTasks: this.getAllTasks(),
      executionState,
    };
  }

  /**
   * Subscribe to task events
   */
  on<K extends keyof TaskEvents>(event: K, handler: TaskEvents[K]): void {
    this.events[event] = handler;
  }

  /**
   * Unsubscribe from task events
   */
  off<K extends keyof TaskEvents>(event: K): void {
    delete this.events[event];
  }

  /**
   * Clear all tasks
   */
  clear(): void {
    this.tasks.clear();
    this.taskQueue = [];
    this.currentTaskId = null;
    logger.debug('All tasks cleared');
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Format task for message content
   */
  formatTaskForMessage(task: TaskInfo): string {
    const content = `Your ultimate task is: """${task.description}""". If you achieved your ultimate task, stop everything and use the done action in the next step to complete the task. If not, continue as usual.`;
    return wrapUserRequest(content);
  }

  /**
   * Format follow-up task for message content
   */
  formatFollowUpTaskForMessage(task: TaskInfo): string {
    const content = `Your new ultimate task is: """${task.description}""". This is a follow-up of the previous tasks. Make sure to take all of the previous context into account and finish your new ultimate task.`;
    return wrapUserRequest(content);
  }

  private getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }
}
