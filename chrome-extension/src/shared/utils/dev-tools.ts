import { getAppConfig } from '@src/shared/config';
import type { WorkflowContext } from '@src/core/workflow/context';
import type { PlannerOutput } from '@src/shared/types';
import { createLogger } from '@src/infrastructure/monitoring/logger';

const logger = createLogger('DevTools');

/**
 * Development tools for debugging and inspection
 * Only active in development mode
 */
export class DevTools {
  private static get isDevelopment(): boolean {
    return getAppConfig().development.debugMode;
  }

  /**
   * Inspect the current planning state
   */
  static inspectPlanningState(context: WorkflowContext): void {
    if (!this.isDevelopment) return;

    logger.debug('Planning State Inspection', {
      taskId: context.taskId,
      currentStep: context.nSteps,
      planningInterval: context.config.planningInterval,
      shouldPlan: context.shouldPlan(),
      pendingPlan: context.pendingPlan,
      planAwaitingUserResponse: context.planAwaitingUserResponse,
      currentWebTask: context.currentWebTask,
      taskDone: context.currentTaskIsDone,
    });
  }

  /**
   * Debug execution flow
   */
  static debugExecution(context: WorkflowContext): void {
    if (!this.isDevelopment) return;

    const summary = context.getExecutionSummary();

    logger.debug('Execution Debug', {
      summary,
      actionResults: context.actionResults.length,
      messageHistoryLength: context.messageManager.length(),
      stateMessageAdded: context.stateMessageAdded,
      controllerAborted: context.controller.signal.aborted,
    });
  }

  /**
   * Validate current configuration
   */
  static validateConfiguration(): boolean {
    if (!this.isDevelopment) return true;

    const config = getAppConfig();
    const issues: string[] = [];

    // Check agent config
    if (config.agent.maxSteps <= 0) {
      issues.push('maxSteps must be greater than 0');
    }
    if (config.agent.planningInterval <= 0) {
      issues.push('planningInterval must be greater than 0');
    }
    if (config.agent.maxFailures <= 0) {
      issues.push('maxFailures must be greater than 0');
    }

    // Check browser config
    if (config.browser.defaultTimeout <= 0) {
      issues.push('defaultTimeout must be greater than 0');
    }

    if (issues.length > 0) {
      logger.warning('⚠️ Configuration Issues', { issues });
      return false;
    }

    logger.info('✅ Configuration is valid');
    return true;
  }

  /**
   * Analyze plan quality
   */
  static analyzePlan(plan: PlannerOutput): void {
    if (!this.isDevelopment) return;

    try {
      logger.debug('Plan Analysis', {
        observationLength: plan.observation.length,
        numberOfSteps: plan.next_steps.length,
        currentStep: plan.current_step,
        isWebTask: plan.web_task,
        isDone: plan.done,
      });

      // Check for common issues
      const issues: string[] = [];

      if (plan.observation.length < 10) {
        issues.push('Observation too short');
      }

      if (plan.next_steps.length === 0 && !plan.done) {
        issues.push('No next steps provided but task not done');
      }

      if (issues.length > 0) {
        logger.warning('⚠️ Plan issues detected', { issues });
      } else {
        logger.info('✅ Plan looks good');
      }
    } catch (error) {
      logger.error('❌ Plan analysis failed', error as Error);
    }
  }

  /**
   * Monitor memory usage (simple)
   */
  static monitorMemory(): void {
    if (!this.isDevelopment) return;

    if ('memory' in performance) {
      const memory = (performance as any).memory;
      logger.debug('Memory Usage', {
        used: Math.round(memory.usedJSHeapSize / 1024 / 1024) + ' MB',
        total: Math.round(memory.totalJSHeapSize / 1024 / 1024) + ' MB',
        limit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024) + ' MB',
      });
    } else {
      logger.debug('Memory monitoring not available');
    }
  }

  /**
   * Performance timing helper
   */
  static time(label: string): () => void {
    if (!this.isDevelopment) return () => {};

    const start = performance.now();
    console.time(label);

    return () => {
      const end = performance.now();
      console.timeEnd(label);
      logger.debug(`⏱️ ${label}`, { duration: Math.round(end - start) + 'ms' });
    };
  }

  /**
   * Export debug data for analysis
   */
  static exportDebugData(context: WorkflowContext): string {
    if (!this.isDevelopment) return '';

    const debugData = {
      timestamp: new Date().toISOString(),
      config: getAppConfig(),
      execution: context.getExecutionSummary(),
      messageHistory: context.messageManager.length(),
      actionResults: context.actionResults.length,
      planningState: {
        pendingPlan: context.pendingPlan,
        awaitingResponse: context.planAwaitingUserResponse,
        webTask: context.currentWebTask,
        taskDone: context.currentTaskIsDone,
      },
    };

    const jsonString = JSON.stringify(debugData, null, 2);
    logger.info('📊 Debug data exported', {
      dataSize: JSON.stringify(debugData).length,
      timestamp: debugData.timestamp,
    });
    return jsonString;
  }

  /**
   * Set up automatic debugging for a context
   */
  static setupAutoDebug(context: WorkflowContext): void {
    if (!this.isDevelopment) return;

    let lastStep = -1;
    const checkInterval = setInterval(() => {
      if (context.nSteps !== lastStep) {
        lastStep = context.nSteps;
        logger.debug(`🔄 Step ${context.nSteps} completed`);
        this.debugExecution(context);
      }

      if (context.stopped) {
        clearInterval(checkInterval);
        logger.info('🏁 Auto-debug stopped - execution finished');
      }
    }, 1000);

    logger.info('🤖 Auto-debug enabled - monitoring every 1s');
  }
}
