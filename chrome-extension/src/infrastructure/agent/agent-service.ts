import { createLogger } from '@src/infrastructure/monitoring/logger';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type BrowserContext from '@src/background/browser/context';
import { AgentFactory, type AgentFactoryConfig, type AgentCollection } from './agent-factory';
import { AgentExecutionPipeline } from './execution-pipeline';
import { TaskManager, TaskStatus, type TaskInfo } from './task-manager';
import { type EventCallback, EventType } from '@src/background/agent/event/types';
import { ExecutionError, ConfigurationError } from '@src/shared/types/errors';

const logger = createLogger('AgentService');

/**
 * Configuration for the agent service
 */
export interface AgentServiceConfig extends Omit<AgentFactoryConfig, 'task' | 'taskId'> {
  enableTaskManagement?: boolean;
  enablePipeline?: boolean;
}

/**
 * Agent execution result
 */
export interface AgentExecutionResult {
  taskId: string;
  status: TaskStatus;
  error?: Error;
  duration?: number;
  stepsExecuted?: number;
}

/**
 * High-level agent service that orchestrates execution
 */
export class AgentService {
  private config: AgentServiceConfig;
  private taskManager: TaskManager;
  private currentExecution?: {
    pipeline: AgentExecutionPipeline;
    agents: AgentCollection;
    startTime: Date;
  };

  constructor(config: AgentServiceConfig) {
    this.config = config;
    this.taskManager = new TaskManager();

    logger.info('Agent service initialized', {
      hasPlanner: !!config.plannerLLM,
      hasValidator: !!config.validatorLLM,
      taskManagementEnabled: config.enableTaskManagement ?? true,
      pipelineEnabled: config.enablePipeline ?? true,
    });
  }

  /**
   * Execute a task with the agent system
   */
  async executeTask(task: string): Promise<AgentExecutionResult> {
    logger.info('Starting task execution', {
      task: task.substring(0, 100),
      enableTaskManagement: this.config.enableTaskManagement,
    });

    const taskInfo = this.config.enableTaskManagement
      ? this.taskManager.createTask(task)
      : ({ id: this.generateTaskId(), description: task, status: TaskStatus.PENDING } as TaskInfo);

    const startTime = new Date();

    try {
      // Create agents for this task
      const factoryConfig: AgentFactoryConfig = {
        ...this.config,
        task: taskInfo.description,
        taskId: taskInfo.id,
      };

      const factory = new AgentFactory(factoryConfig);
      const agents = factory.createAgents();

      // Start task if using task management
      if (this.config.enableTaskManagement) {
        await this.taskManager.start(taskInfo.id);
      }

      // Execute task using pipeline
      if (this.config.enablePipeline) {
        const pipeline = new AgentExecutionPipeline(agents.context, agents.navigator, agents.planner, agents.validator);

        this.currentExecution = {
          pipeline,
          agents,
          startTime,
        };

        await pipeline.execute();
      } else {
        // Direct agent execution without pipeline orchestration
        const result = await agents.navigator.execute();

        if (!result.result?.done) {
          throw new ExecutionError('Task did not complete successfully');
        }
      }

      // Complete task
      if (this.config.enableTaskManagement) {
        await this.taskManager.complete(taskInfo.id);
      }

      const duration = Date.now() - startTime.getTime();

      logger.info('Task execution completed', {
        taskId: taskInfo.id,
        duration,
        stepsExecuted: agents.context.nSteps,
      });

      return {
        taskId: taskInfo.id,
        status: TaskStatus.COMPLETED,
        duration,
        stepsExecuted: agents.context.nSteps,
      };
    } catch (error) {
      const errorObj = error as Error;

      // Fail task if using task management
      if (this.config.enableTaskManagement) {
        await this.taskManager.fail(taskInfo.id, errorObj.message);
      }

      logger.error('Task execution failed', errorObj, {
        taskId: taskInfo.id,
        duration: Date.now() - startTime.getTime(),
      });

      return {
        taskId: taskInfo.id,
        status: TaskStatus.FAILED,
        error: errorObj,
        duration: Date.now() - startTime.getTime(),
      };
    } finally {
      this.currentExecution = undefined;
    }
  }

  /**
   * Add a follow-up task
   */
  async addFollowUpTask(task: string): Promise<TaskInfo> {
    if (!this.config.enableTaskManagement) {
      throw new ConfigurationError('Task management is disabled');
    }

    const followUpTask = await this.taskManager.addFollowUp(task);

    logger.info('Follow-up task added', {
      taskId: followUpTask.id,
      description: task.substring(0, 100),
    });

    return followUpTask;
  }

  /**
   * Subscribe to execution events
   */
  subscribeToEvents(callback: EventCallback): void {
    if (this.currentExecution) {
      this.currentExecution.pipeline.subscribeToEvents(callback);
    } else {
      logger.warn('No active execution to subscribe to events');
    }
  }

  /**
   * Clear execution event listeners
   */
  clearEventListeners(): void {
    if (this.currentExecution) {
      this.currentExecution.pipeline.clearEventListeners();
    }
  }

  /**
   * Pause current execution
   */
  async pause(): Promise<void> {
    if (!this.currentExecution) {
      throw new ExecutionError('No active execution to pause');
    }

    await this.currentExecution.pipeline.pause();
    logger.info('Execution paused');
  }

  /**
   * Resume current execution
   */
  async resume(): Promise<void> {
    if (!this.currentExecution) {
      throw new ExecutionError('No active execution to resume');
    }

    await this.currentExecution.pipeline.resume();
    logger.info('Execution resumed');
  }

  /**
   * Cancel current execution
   */
  async cancel(): Promise<void> {
    if (!this.currentExecution) {
      throw new ExecutionError('No active execution to cancel');
    }

    await this.currentExecution.pipeline.cancel();

    if (this.config.enableTaskManagement) {
      const currentTask = this.taskManager.getCurrentTask();
      if (currentTask) {
        await this.taskManager.cancel(currentTask.id);
      }
    }

    logger.info('Execution cancelled');
  }

  /**
   * Get task manager (if enabled)
   */
  getTaskManager(): TaskManager | null {
    return this.config.enableTaskManagement ? this.taskManager : null;
  }

  /**
   * Get current execution status
   */
  getExecutionStatus(): {
    isExecuting: boolean;
    currentTask?: TaskInfo;
    startTime?: Date;
    duration?: number;
  } {
    const isExecuting = !!this.currentExecution;
    const currentTask = this.config.enableTaskManagement ? this.taskManager.getCurrentTask() : undefined;

    return {
      isExecuting,
      currentTask: currentTask || undefined,
      startTime: this.currentExecution?.startTime,
      duration: this.currentExecution ? Date.now() - this.currentExecution.startTime.getTime() : undefined,
    };
  }

  /**
   * Get service statistics
   */
  getStatistics(): {
    tasks?: ReturnType<TaskManager['getStatistics']>;
    currentExecution?: {
      stepCount: number;
      maxSteps: number;
      duration: number;
    };
  } {
    const stats: ReturnType<AgentService['getStatistics']> = {};

    if (this.config.enableTaskManagement) {
      stats.tasks = this.taskManager.getStatistics();
    }

    if (this.currentExecution) {
      stats.currentExecution = {
        stepCount: this.currentExecution.agents.context.nSteps,
        maxSteps: this.currentExecution.agents.context.options.maxSteps,
        duration: Date.now() - this.currentExecution.startTime.getTime(),
      };
    }

    return stats;
  }

  /**
   * Update service configuration
   */
  updateConfig(updates: Partial<AgentServiceConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.debug('Agent service configuration updated', { updates });
  }

  /**
   * Cleanup service resources
   */
  async cleanup(): Promise<void> {
    if (this.currentExecution) {
      await this.cancel();
    }

    if (this.config.enableTaskManagement) {
      this.taskManager.clear();
    }

    logger.info('Agent service cleaned up');
  }

  /**
   * Generate task ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
