import 'webextension-polyfill';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  llmProviderStore,
  getAgentModel,
} from '@extension/storage';
import BrowserContext from './browser/context';
import { Executor } from './agent/executor';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { DOMTextProcessor } from '@src/infrastructure/dom/text-processor';
import { getAppConfig } from '@src/shared/config';
import { AgentService } from '@src/infrastructure/agent/agent-service';
import { ConfigurationError } from '@src/shared/types/errors';
import { createLogger } from '@src/infrastructure/monitoring/logger';

const logger = createLogger('Background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;

// Setup side panel behavior
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(error => logger.error('Failed to set panel behavior', error as Error));

// Listen for debugger detached event
// if canceled_by_user, remove the tab from the browser context
chrome.debugger.onDetach.addListener(async (source, reason) => {
  logger.debug('Debugger detached', { source, reason });
  if (reason === 'canceled_by_user') {
    if (source.tabId) {
      currentExecutor?.cancel();
      await browserContext.cleanup();
    }
  }
});

// Cleanup when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  browserContext.removeAttachedPage(tabId);
});

logger.info('background loaded');

// Listen for simple messages (e.g., from options page)
chrome.runtime.onMessage.addListener(() => {
  // Handle other message types if needed in the future
  // Return false if response is not sent asynchronously
  // return false;
});

// Setup connection listener for long-lived connections (e.g., side panel)
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'side-panel-connection') {
    currentPort = port;

    port.onMessage.addListener(async message => {
      try {
        // It's useful to have access to the executor's context here if it exists
        const executorContext = currentExecutor?.context; // Get context if executor exists

        switch (message.type) {
          case 'heartbeat':
            port.postMessage({ type: 'heartbeat_ack' });
            break;

          case 'new_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: 'No task provided' });
            if (!message.tabId) return port.postMessage({ type: 'error', error: 'No tab ID provided' });

            logger.info('[Background] new_task received:', message.tabId, message.task);
            if (currentExecutor) {
              // If an old executor exists, cancel it before starting a new one for a completely new task.
              logger.info('[Background] Cancelling existing executor for new_task.');
              await currentExecutor.cancel();
            }
            currentExecutor = await setupExecutor(message.taskId as string, message.task as string, browserContext);

            // Start execution first, then subscribe to events
            const executePromise = currentExecutor.execute();

            // Subscribe to events after execution starts (small delay to ensure currentExecution is set)
            setTimeout(() => {
              subscribeToExecutorEvents(currentExecutor!);
            }, 100);

            await executePromise;
            logger.info('[Background] Initial execution cycle for new_task started.', message.tabId);
            break;
          }
          case 'follow_up_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: 'No follow up task provided' });
            if (!message.tabId) return port.postMessage({ type: 'error', error: 'No tab ID provided' });

            if (currentExecutor) {
              logger.info('[Background] follow_up_task received:', message.tabId, message.task);
              await currentExecutor.addFollowUpTask(message.task as string);

              // Start execution first, then subscribe to events
              const executePromise = currentExecutor.execute();

              // Subscribe to events after execution starts (small delay to ensure currentExecution is set)
              setTimeout(() => {
                subscribeToExecutorEvents(currentExecutor!);
              }, 100);

              await executePromise;
              logger.info('[Background] Execution cycle for follow_up_task started.', message.tabId);
            } else {
              logger.info('[Background] follow_up_task: executor was cleaned up or not initialized. Cannot process.');
              return port.postMessage({ type: 'error', error: 'Executor not available for follow-up task.' });
            }
            break;
          }

          case 'cancel_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: 'No task to cancel' });
            logger.info('[Background] cancel_task received');
            await currentExecutor.cancel();
            // currentExecutor = null; // Consider if executor should be nulled immediately after cancel
            break;
          }

          case 'resume_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: 'No task to resume' });
            logger.info('[Background] resume_task received');
            await currentExecutor.resume();
            // resume() itself now calls execute() if not awaiting plan, so no explicit call here.
            return port.postMessage({ type: 'success', msg: 'Resume requested.' });
          }

          case 'pause_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: 'No task to pause' });
            logger.info('[Background] pause_task received');
            await currentExecutor.pause();
            return port.postMessage({ type: 'success', msg: 'Pause requested.' });
          }

          case 'screenshot': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: 'No tab ID provided' });
            const page = await browserContext.switchTab(message.tabId);
            const screenshot = await page.takeScreenshot();
            logger.info('screenshot', message.tabId, screenshot);
            return port.postMessage({ type: 'success', screenshot });
          }

          case 'state': {
            try {
              const browserState = await browserContext.getState(true);
              const elementsText = DOMTextProcessor.clickableElementsToString(
                browserState.elementTree,
                DEFAULT_AGENT_OPTIONS.includeAttributes,
              );

              logger.debug('Browser state retrieved', {
                elementCount: browserState.selectorMap.size,
                hasElementTree: !!browserState.elementTree,
              });
              logger.debug('Interactive elements', { elementsText });
              return port.postMessage({ type: 'success', msg: 'State printed to console' });
            } catch (error) {
              logger.error('Failed to get state:', error);
              return port.postMessage({ type: 'error', error: 'Failed to get state' });
            }
          }

          case 'nohighlight': {
            const page = await browserContext.getCurrentPage();
            await page.removeHighlight();
            return port.postMessage({ type: 'success', msg: 'highlight removed' });
          }

          default:
            return port.postMessage({ type: 'error', error: 'Unknown message type' });
        }
      } catch (error) {
        logger.error('Error handling port message', error as Error, { messageType: message.type });
        port.postMessage({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    port.onDisconnect.addListener(() => {
      // this event is also triggered when the side panel is closed, so we need to cancel the task
      logger.debug('Side panel disconnected');
      currentPort = null;
      currentExecutor?.cancel();
    });
  }
});

async function setupExecutor(taskId: string, task: string, browserContext: BrowserContext) {
  const providers = await llmProviderStore.getAllProviders();
  // if no providers, need to display the options page
  if (Object.keys(providers).length === 0) {
    throw new ConfigurationError('Please configure API keys in the settings first');
  }
  const agentModels = await agentModelStore.getAllAgentModels();
  // verify if every provider used in the agent models exists in the providers
  for (const agentModel of Object.values(agentModels)) {
    if (!providers[agentModel.provider]) {
      throw new ConfigurationError(`Provider ${agentModel.provider} not found in the settings`);
    }
  }

  const navigatorModel = agentModels[AgentNameEnum.Navigator];
  if (!navigatorModel) {
    throw new ConfigurationError('Please choose a model for the navigator in the settings first');
  }
  // Log the provider config being used for the navigator
  const navigatorProviderConfig = providers[navigatorModel.provider];
  const navigatorLLM = createChatModel(navigatorProviderConfig, navigatorModel);

  let plannerLLM: BaseChatModel | null = null;
  const plannerModel = agentModels[AgentNameEnum.Planner];
  if (plannerModel) {
    // Log the provider config being used for the planner
    const plannerProviderConfig = providers[plannerModel.provider];
    plannerLLM = createChatModel(plannerProviderConfig, plannerModel);
  }

  let validatorLLM: BaseChatModel | null = null;
  const validatorModel = agentModels[AgentNameEnum.Validator];
  if (validatorModel) {
    // Log the provider config being used for the validator
    const validatorProviderConfig = providers[validatorModel.provider];
    validatorLLM = createChatModel(validatorProviderConfig, validatorModel);
  }

  // Apply firewall settings to browser context
  const firewall = await firewallStore.getFirewall();
  if (firewall.enabled) {
    browserContext.updateConfig({
      allowedUrls: firewall.allowList,
      deniedUrls: firewall.denyList,
    });
  } else {
    browserContext.updateConfig({
      allowedUrls: [],
      deniedUrls: [],
    });
  }

  const generalSettings = await generalSettingsStore.getSettings();
  const executor = new Executor(task, taskId, browserContext, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    validatorLLM: validatorLLM ?? navigatorLLM,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
    },
  });

  return executor;
}

// Update subscribeToExecutorEvents to use port
async function subscribeToExecutorEvents(executor: Executor) {
  // Clear previous event listeners to prevent multiple subscriptions
  executor.clearExecutionEvents();

  logger.info('[Background] Setting up event subscription', { hasCurrentPort: !!currentPort });

  // Subscribe to new events
  executor.subscribeExecutionEvents(async event => {
    try {
      logger.info('[Background] Event received for forwarding', {
        eventType: event.type,
        actor: event.actor,
        state: event.state,
        hasCurrentPort: !!currentPort,
      });

      if (currentPort) {
        logger.info('[Background] Sending event to side panel', {
          eventType: event.type,
          actor: event.actor,
          state: event.state,
        });
        currentPort.postMessage(event);
        logger.info('[Background] Event sent successfully');
      } else {
        logger.warn('[Background] currentPort is null, cannot send event to side panel', {
          eventType: event.type,
          actor: event.actor,
          state: event.state,
        });
      }
    } catch (error) {
      logger.error('Failed to send message to side panel:', error);
    }

    if (
      event.state === ExecutionState.TASK_OK ||
      event.state === ExecutionState.TASK_FAIL ||
      event.state === ExecutionState.TASK_CANCEL
    ) {
      await currentExecutor?.cleanup();
    }
  });
}
