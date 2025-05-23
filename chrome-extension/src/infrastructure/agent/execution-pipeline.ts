import { createLogger } from '@src/infrastructure/monitoring/logger';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AgentContext, type AgentOptions } from '@src/background/agent/types';
import { NavigatorAgent, NavigatorActionRegistry } from '@src/background/agent/agents/navigator';
import { PlannerAgent, type PlannerOutput } from '@src/background/agent/agents/planner';
import { ValidatorAgent } from '@src/background/agent/agents/validator';
import { Actors, type EventCallback, EventType, ExecutionState } from '@src/background/agent/event/types';
import { wrapUntrustedContent } from '@src/background/agent/messages/utils';
import { ExecutionError } from '@src/shared/types/errors';

const logger = createLogger('ExecutionPipeline');

/**
 * Execution step configuration
 */
export interface ExecutionStep {
  stepNumber: number;
  maxSteps: number;
  shouldPlan: boolean;
  shouldNavigate: boolean;
  shouldValidate: boolean;
}

/**
 * Pipeline state for tracking execution progress
 */
export interface PipelineState {
  currentStep: number;
  maxSteps: number;
  done: boolean;
  validatorFailed: boolean;
  webTask?: string;
  consecutiveFailures: number;
}

/**
 * Execution pipeline for managing agent flow
 */
export class AgentExecutionPipeline {
  private readonly context: AgentContext;
  private readonly navigator: NavigatorAgent;
  private readonly planner?: PlannerAgent;
  private readonly validator?: ValidatorAgent;

  constructor(context: AgentContext, navigator: NavigatorAgent, planner?: PlannerAgent, validator?: ValidatorAgent) {
    this.context = context;
    this.navigator = navigator;
    this.planner = planner;
    this.validator = validator;
  }

  /**
   * Execute the complete pipeline
   */
  async execute(): Promise<void> {
    logger.info('Starting agent execution pipeline', {
      taskId: this.context.taskId,
      maxSteps: this.context.options.maxSteps,
    });

    const state: PipelineState = {
      currentStep: 0,
      maxSteps: this.context.options.maxSteps,
      done: false,
      validatorFailed: false,
      consecutiveFailures: 0,
    };

    this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_START, this.context.taskId);

    try {
      while (state.currentStep < state.maxSteps && !state.done) {
        const step = this.createExecutionStep(state);

        // Update step info before any agent execution
        this.updateStepInfo(step);

        logger.info(`Executing step ${step.stepNumber + 1}/${step.maxSteps}`, {
          shouldPlan: step.shouldPlan,
          shouldNavigate: step.shouldNavigate,
          shouldValidate: step.shouldValidate,
        });

        if (await this.shouldStop()) {
          break;
        }

        // Execute planning phase
        if (step.shouldPlan && this.planner) {
          const planResult = await this.executePlanningPhase(state);
          if (planResult.done) {
            state.done = true;
            if (this.validator) {
              this.validator.setPlan(planResult.nextSteps);
            }
          } else {
            if (this.validator) {
              this.validator.setPlan(null);
            }
            state.done = false;
          }

          // Set web task on first planning
          if (!state.webTask && planResult.webTask) {
            state.webTask = planResult.webTask;
          }

          // Complete if no web task and done
          if (!state.webTask && planResult.done) {
            break;
          }

          state.validatorFailed = false;
        }

        // Execute navigation phase
        if (step.shouldNavigate && !state.done) {
          state.done = await this.executeNavigationPhase();
        }

        // Execute validation phase
        if (step.shouldValidate && state.done && this.validator) {
          const validationResult = await this.executeValidationPhase();
          if (!validationResult.isValid) {
            state.validatorFailed = true;
            state.consecutiveFailures++;
            state.done = false;

            if (state.consecutiveFailures >= this.context.options.maxValidatorFailures) {
              throw new ExecutionError(`Too many validator failures: ${state.consecutiveFailures}`);
            }
          } else {
            logger.info('Task completed successfully');
            break;
          }
        }

        state.currentStep++;
        this.context.nSteps = state.currentStep;
      }

      if (state.currentStep >= state.maxSteps) {
        logger.warn('Pipeline completed due to maximum steps reached');
      } else {
        logger.info('Pipeline completed successfully');
      }
    } catch (error) {
      logger.error('Pipeline execution failed', error as ExecutionError);
      throw error;
    } finally {
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_END, this.context.taskId);
    }
  }

  /**
   * Execute planning phase
   */
  private async executePlanningPhase(state: PipelineState): Promise<{
    done: boolean;
    nextSteps: string[] | null;
    webTask?: string;
  }> {
    if (!this.planner) {
      return { done: false, nextSteps: null };
    }

    logger.debug('Executing planning phase', { currentStep: state.currentStep });

    // Add state message for planning context
    let positionForPlan = 0;
    const isFirstStep = state.currentStep === 0 && this.getTotalTasks() === 1;

    if (!isFirstStep) {
      await this.navigator.addStateMessageToMemory();
      positionForPlan = this.context.messageManager.length() - 1;
    } else {
      positionForPlan = this.context.messageManager.length();
    }

    const planOutput = await this.planner.execute();

    if (planOutput.result) {
      const observation = wrapUntrustedContent(planOutput.result.observation);
      const plan: PlannerOutput = {
        ...planOutput.result,
        observation,
      };

      this.context.messageManager.addPlan(JSON.stringify(plan), positionForPlan);

      return {
        done: planOutput.result.done,
        nextSteps: planOutput.result.next_steps,
        webTask: planOutput.result.web_task,
      };
    }

    return { done: false, nextSteps: null };
  }

  /**
   * Execute navigation phase
   */
  private async executeNavigationPhase(): Promise<boolean> {
    logger.debug('Executing navigation phase');

    const navigatorOutput = await this.navigator.execute();
    return navigatorOutput.result?.done ?? false;
  }

  /**
   * Execute validation phase
   */
  private async executeValidationPhase(): Promise<{ isValid: boolean }> {
    if (!this.validator) {
      return { isValid: true };
    }

    logger.debug('Executing validation phase');

    const validatorOutput = await this.validator.execute();
    return { isValid: validatorOutput.result?.is_valid ?? false };
  }

  /**
   * Create execution step configuration
   */
  private createExecutionStep(state: PipelineState): ExecutionStep {
    const shouldPlan =
      this.planner && (state.currentStep % this.context.options.planningInterval === 0 || state.validatorFailed);

    const shouldNavigate = !state.done;

    const shouldValidate =
      state.done && this.context.options.validateOutput && !this.context.stopped && !this.context.paused;

    return {
      stepNumber: state.currentStep,
      maxSteps: state.maxSteps,
      shouldPlan,
      shouldNavigate,
      shouldValidate,
    };
  }

  /**
   * Update step information in context
   */
  private updateStepInfo(step: ExecutionStep): void {
    this.context.stepInfo = {
      stepNumber: step.stepNumber,
      maxSteps: step.maxSteps,
    };
  }

  /**
   * Check if execution should stop
   */
  private async shouldStop(): Promise<boolean> {
    if (this.context.paused) {
      logger.info('Pipeline paused');
      return true;
    }

    if (this.context.stopped) {
      logger.info('Pipeline stopped');
      return true;
    }

    return false;
  }

  /**
   * Get total number of tasks (placeholder - would need access to task list)
   */
  private getTotalTasks(): number {
    // This would need to be passed in or tracked elsewhere
    return 1;
  }

  /**
   * Subscribe to execution events
   */
  subscribeToEvents(callback: EventCallback): void {
    this.context.eventManager.subscribe(EventType.EXECUTION, callback);
  }

  /**
   * Clear execution event listeners
   */
  clearEventListeners(): void {
    this.context.eventManager.clearSubscribers(EventType.EXECUTION);
  }

  /**
   * Pause execution
   */
  async pause(): Promise<void> {
    logger.info('Pausing execution pipeline');
    this.context.paused = true;
  }

  /**
   * Resume execution
   */
  async resume(): Promise<void> {
    logger.info('Resuming execution pipeline');
    this.context.paused = false;
  }

  /**
   * Cancel execution
   */
  async cancel(): Promise<void> {
    logger.info('Cancelling execution pipeline');
    this.context.stopped = true;
    this.context.controller.abort();
  }
}
