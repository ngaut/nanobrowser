import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createLogger } from '@src/infrastructure/monitoring/logger';
import type BrowserContext from '../browser/context';
import { type EventCallback, EventType } from './event/types';

// Import new infrastructure
import { AgentService, type AgentServiceConfig } from '@src/infrastructure/agent/agent-service';
import { TaskStatus } from '@src/infrastructure/agent/task-manager';

const logger = createLogger('Executor');

export interface ExecutorExtraArgs {
  plannerLLM?: BaseChatModel;
  validatorLLM?: BaseChatModel;
  extractorLLM?: BaseChatModel;
  agentOptions?: Partial<{
    maxSteps: number;
    maxFailures: number;
    maxActionsPerStep: number;
    useVision: boolean;
    useVisionForPlanner: boolean;
    planningInterval: number;
    validateOutput: boolean;
    maxValidatorFailures: number;
    includeAttributes: string[];
  }>;
}

export class Executor {
  private agentService: AgentService;
  private tasks: string[] = [];

  constructor(
    task: string,
    taskId: string,
    browserContext: BrowserContext,
    navigatorLLM: BaseChatModel,
    extraArgs?: Partial<ExecutorExtraArgs>,
  ) {
    logger.info('Initializing executor with infrastructure');

    const serviceConfig: AgentServiceConfig = {
      browserContext,
      navigatorLLM,
      plannerLLM: extraArgs?.plannerLLM,
      validatorLLM: extraArgs?.validatorLLM,
      extractorLLM: extraArgs?.extractorLLM,
      agentOptions: extraArgs?.agentOptions,
      enableTaskManagement: true,
      enablePipeline: true,
    };

    this.agentService = new AgentService(serviceConfig);
    this.tasks.push(task);
  }

  subscribeExecutionEvents(callback: EventCallback): void {
    this.agentService.subscribeToEvents(callback);
  }

  clearExecutionEvents(): void {
    this.agentService.clearEventListeners();
  }

  async addFollowUpTask(task: string): Promise<void> {
    await this.agentService.addFollowUpTask(task);
    this.tasks.push(task);
  }

  /**
   * Execute the task using infrastructure
   */
  async execute(): Promise<void> {
    logger.info(`🚀 Executing task: ${this.tasks[this.tasks.length - 1]}`);

    try {
      const result = await this.agentService.executeTask(this.tasks[this.tasks.length - 1]);

      if (result.status === TaskStatus.FAILED) {
        throw result.error || new Error('Task execution failed');
      }

      logger.info('✅ Task completed', {
        taskId: result.taskId,
        duration: result.duration,
        stepsExecuted: result.stepsExecuted,
      });
    } catch (error) {
      logger.error('❌ Task execution failed', error as Error);
      throw error;
    }
  }

  async cancel(): Promise<void> {
    await this.agentService.cancel();
  }

  async resume(): Promise<void> {
    await this.agentService.resume();
  }

  async pause(): Promise<void> {
    await this.agentService.pause();
  }

  async cleanup(): Promise<void> {
    await this.agentService.cleanup();
  }

  async getCurrentTaskId(): Promise<string> {
    const status = this.agentService.getExecutionStatus();
    return status.currentTask?.id || 'unknown';
  }
}
