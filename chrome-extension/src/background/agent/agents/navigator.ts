import { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { ActionResult, type AgentOutput } from '../types';
import type { Action } from '../actions/builder';
import { buildDynamicActionSchema } from '../actions/builder';
import { agentBrainSchema } from '../types';
import { type BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { Actors, ExecutionState } from '../event/types';
import {
  ChatModelAuthError,
  ChatModelForbiddenError,
  isAbortedError,
  isAuthenticationError,
  isForbiddenError,
  LLM_FORBIDDEN_ERROR_MESSAGE,
  RequestCancelledError,
} from './errors';
import { jsonNavigatorOutputSchema } from '../actions/json_schema';
import { geminiNavigatorOutputSchema } from '../actions/json_gemini';
import { calcBranchPathHashSet } from '@src/background/dom/views';
import { URLNotAllowedError } from '@src/background/browser/views';

const logger = createLogger('NavigatorAgent');

// Constants for better maintainability
const CONSTANTS = {
  TASK_INSTRUCTION_PREFIX: '<nano_user_request>\nYour ultimate task is: ',
  PLAN_TAG_START: '<plan>',
  PLAN_TAG_REGEX: /<plan>([\s\S]*?)<\/plan>/,
  ACTION_WAIT_TIME: 1000,
  MAX_ACTION_ERRORS: 3,
  DEFAULT_MESSAGES: {
    TASK_NOT_FOUND: 'Task instruction not found.',
    PLAN_NOT_FOUND: 'Active plan not found.',
    NO_NEXT_STEP: 'No next step defined.',
    UNKNOWN_PAGE: 'Unknown',
    ANALYSIS_ERROR: 'Unable to analyze current action context',
  },
} as const;

// Types for better type safety
interface TaskInformation {
  taskInstruction: string;
  activePlan: string;
  planSteps: string[];
  nextPlanStep: string;
}

interface EnhancedBrowserState {
  title: string;
  url: string;
  tabId: number;
  elementTree: any;
  tabs: any[];
  pixelsAbove: number;
  pixelsBelow: number;
}

interface NavigatorDetails {
  status: string;
  step: number;
  timestamp: string;

  // Prominent page information for UI display
  currentPage: {
    title: string;
    url: string;
    tabId: number;
  };

  browserState: {
    currentPage: {
      title: string;
      url: string;
      tabId: number;
    };
    interactiveElementsCount: number;
    scrollPosition: {
      pixelsAbove: number;
      pixelsBelow: number;
    };
    openTabs: Array<{
      id: number;
      title: string;
      url: string;
      isActive: boolean;
    }>;
  };
  planInfo: {
    hasPlan: boolean;
    nextStep: string;
    upcomingSteps: string[];
    totalStepsInPlan: number;
  };
  actionAnalysis: string;
  temporalContext: {
    stepNumber: number;
    maxSteps: number;
    progressPercentage: number;
    executionStartTime: string;
    planningInterval: number;
    isPlannningStep: boolean;
  };
  inputs: {
    taskInstruction: string;
    activePlan: string;
  };
}

export class NavigatorActionRegistry {
  private actions: Record<string, Action> = {};

  constructor(actions: Action[]) {
    for (const action of actions) {
      this.registerAction(action);
    }
  }

  registerAction(action: Action): void {
    this.actions[action.name()] = action;
  }

  unregisterAction(name: string): void {
    delete this.actions[name];
  }

  getAction(name: string): Action | undefined {
    return this.actions[name];
  }

  setupModelOutputSchema(): z.ZodType {
    const actionSchema = buildDynamicActionSchema(Object.values(this.actions));
    return z.object({
      current_state: agentBrainSchema,
      action: z.array(actionSchema),
    });
  }
}

export interface NavigatorResult {
  done: boolean;
}

export class NavigatorAgent extends BaseAgent<z.ZodType, NavigatorResult> {
  private actionRegistry: NavigatorActionRegistry;
  private jsonSchema: Record<string, unknown>;

  constructor(
    actionRegistry: NavigatorActionRegistry,
    options: BaseAgentOptions,
    extraOptions?: Partial<ExtraAgentOptions>,
  ) {
    super(actionRegistry.setupModelOutputSchema(), options, { ...extraOptions, id: 'navigator' });

    this.actionRegistry = actionRegistry;

    this.jsonSchema = this.modelName.startsWith('gemini') ? geminiNavigatorOutputSchema : jsonNavigatorOutputSchema;

    // logger.info('Navigator zod schema', JSON.stringify(zodToJsonSchema(this.modelOutputSchema), null, 2));
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    // Use structured output
    if (this.withStructuredOutput) {
      const structuredLlm = this.chatLLM.withStructuredOutput(this.jsonSchema, {
        includeRaw: true,
        name: this.modelOutputToolName,
      });

      let response = undefined;
      try {
        response = await structuredLlm.invoke(inputMessages, {
          signal: this.context.controller.signal,
          ...this.callOptions,
        });

        if (response.parsed) {
          return response.parsed;
        }
      } catch (error) {
        if (isAbortedError(error)) {
          throw error;
        }
        const errorMessage = `Failed to invoke ${this.modelName} with structured output: ${error}`;
        throw new Error(errorMessage);
      }

      // Use type assertion to access the properties
      const rawResponse = response.raw as BaseMessage & {
        tool_calls?: Array<{
          args: {
            currentState: typeof agentBrainSchema._type;
            action: z.infer<ReturnType<typeof buildDynamicActionSchema>>;
          };
        }>;
      };

      // sometimes LLM returns an empty content, but with one or more tool calls, so we need to check the tool calls
      if (rawResponse.tool_calls && rawResponse.tool_calls.length > 0) {
        logger.info('Navigator structuredLlm tool call with empty content', rawResponse.tool_calls);
        // only use the first tool call
        const toolCall = rawResponse.tool_calls[0];
        return {
          current_state: toolCall.args.currentState,
          action: [...toolCall.args.action],
        };
      }
      throw new Error('Could not parse response');
    }
    throw new Error('Navigator needs to work with LLM that supports tool calling');
  }

  async execute(): Promise<AgentOutput<NavigatorResult>> {
    const agentOutput: AgentOutput<NavigatorResult> = {
      id: this.id,
    };

    let cancelled = false;

    try {
      // Extract task and plan information
      const taskInfo = this.extractTaskInformation();

      // Get comprehensive browser state
      const browserState = await this.getBrowserStateWithAnalysis();

      // Create and emit enhanced navigator details
      const enhancedDetails = this.createEnhancedNavigatorDetails(taskInfo, browserState);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_START, 'Navigating...', undefined, enhancedDetails);

      // Execute navigation logic
      const result = await this.executeNavigationStep();
      if (result.cancelled) {
        cancelled = true;
        return agentOutput;
      }

      agentOutput.result = { done: result.done };
      return agentOutput;
    } catch (error) {
      return this.handleNavigationError(error, agentOutput);
    } finally {
      if (cancelled) {
        this.handleCancellation();
      }
    }
  }

  /**
   * Get browser state and calculate interactive elements count
   */
  private async getBrowserStateWithAnalysis(): Promise<EnhancedBrowserState & { interactiveElementsCount: number }> {
    // Use consistent vision settings with other agents, and enable caching for performance
    const browserState = await this.context.browserContext.getState(this.context.options.useVision, true);
    const interactiveElementsCount = this.calculateInteractiveElementsCount(browserState.elementTree);

    // Update shared context with current page information
    await this.context.updateCurrentPageInfo();

    // Enhanced error detection and validation
    this.validatePageState(browserState, interactiveElementsCount);

    return {
      ...browserState,
      interactiveElementsCount,
    };
  }

  /**
   * Validate page state and detect common issues
   */
  private validatePageState(browserState: EnhancedBrowserState, interactiveElementsCount: number): void {
    const issues: string[] = [];

    // Check for page loading issues
    if (interactiveElementsCount === 0) {
      issues.push('⚠️ No interactive elements detected - page may not have loaded properly');
    }

    // Check for scroll detection issues
    if (browserState.pixelsAbove === 0 && browserState.pixelsBelow === 0) {
      issues.push('⚠️ Scroll position detection shows 0/0 - page content may not be visible');
    }

    // Check for empty page title (often indicates loading issues)
    if (!browserState.title || browserState.title.trim() === '') {
      issues.push('⚠️ Page title is empty - possible loading issue');
    }

    // Log issues for debugging
    if (issues.length > 0) {
      logger.error('Page state validation issues detected:', issues.join(', '));

      // Emit diagnostic event
      this.context.emitEvent(
        Actors.NAVIGATOR,
        ExecutionState.STEP_START,
        'Page state validation issues detected',
        undefined,
        {
          issues,
          browserState: {
            title: browserState.title,
            url: browserState.url,
            interactiveElementsCount,
            scrollInfo: {
              pixelsAbove: browserState.pixelsAbove,
              pixelsBelow: browserState.pixelsBelow,
            },
          },
        },
      );
    }
  }

  /**
   * Calculate the number of interactive elements on the page
   */
  private calculateInteractiveElementsCount(elementTree: any): number {
    if (!elementTree) return 0;

    return elementTree
      .clickableElementsToString(this.context.options.includeAttributes)
      .split('\n')
      .filter((line: string) => line.trim().match(/^\[\d+\]/)).length;
  }

  /**
   * Create comprehensive navigator details for enhanced output
   */
  private createEnhancedNavigatorDetails(
    taskInfo: TaskInformation,
    browserState: EnhancedBrowserState & { interactiveElementsCount: number },
  ): NavigatorDetails {
    const actionAnalysis = this.analyzeCurrentAction(browserState, taskInfo.taskInstruction, taskInfo.nextPlanStep);

    const currentPageInfo = {
      title: browserState.title || CONSTANTS.DEFAULT_MESSAGES.UNKNOWN_PAGE,
      url: browserState.url || CONSTANTS.DEFAULT_MESSAGES.UNKNOWN_PAGE,
      tabId: browserState.tabId,
    };

    return {
      status: 'navigating',
      step: this.context.nSteps,
      timestamp: new Date().toISOString(),

      // Prominent page information for easy UI access
      currentPage: currentPageInfo,

      browserState: {
        currentPage: currentPageInfo, // Keep for backward compatibility
        interactiveElementsCount: browserState.interactiveElementsCount,
        scrollPosition: {
          pixelsAbove: browserState.pixelsAbove || 0,
          pixelsBelow: browserState.pixelsBelow || 0,
        },
        openTabs:
          browserState.tabs?.map(tab => ({
            id: tab.id,
            title: tab.title,
            url: tab.url,
            isActive: tab.id === browserState.tabId,
          })) || [],
      },

      planInfo: {
        hasPlan: taskInfo.activePlan !== CONSTANTS.DEFAULT_MESSAGES.PLAN_NOT_FOUND,
        nextStep: taskInfo.nextPlanStep,
        upcomingSteps: taskInfo.planSteps.slice(1, 4), // Show up to 3 upcoming steps
        totalStepsInPlan: taskInfo.planSteps.length,
      },

      actionAnalysis,

      temporalContext: {
        stepNumber: this.context.nSteps + 1,
        maxSteps: this.context.options.maxSteps,
        progressPercentage: Math.round(((this.context.nSteps + 1) / this.context.options.maxSteps) * 100),
        executionStartTime: this.context.taskId,
        planningInterval: this.context.options.planningInterval,
        isPlannningStep: this.context.nSteps % this.context.options.planningInterval === 0,
      },

      inputs: {
        taskInstruction: taskInfo.taskInstruction,
        activePlan: taskInfo.activePlan,
      },
    };
  }

  /**
   * Execute the main navigation step logic
   */
  private async executeNavigationStep(): Promise<{ done: boolean; cancelled: boolean }> {
    // Add browser state to memory
    await this.addStateMessageToMemory();

    if (this.context.paused || this.context.stopped) {
      return { done: false, cancelled: true };
    }

    // Get LLM response
    const inputMessages = this.context.messageManager.getMessages();
    const modelOutput = await this.invoke(inputMessages);

    if (this.context.paused || this.context.stopped) {
      return { done: false, cancelled: true };
    }

    // Process model output
    this.removeLastStateMessageFromMemory();
    this.addModelOutputToMemory(modelOutput);

    // Execute actions
    const actionResults = await this.doMultiAction(modelOutput);
    this.context.actionResults = actionResults;

    if (this.context.paused || this.context.stopped) {
      return { done: false, cancelled: true };
    }

    // Emit success event
    this.context.emitEvent(
      Actors.NAVIGATOR,
      ExecutionState.STEP_OK,
      'Navigation done',
      undefined,
      this.context.actionResults,
    );

    const done = actionResults.length > 0 && actionResults[actionResults.length - 1].isDone;
    return { done, cancelled: false };
  }

  /**
   * Handle navigation errors with proper error classification
   */
  private handleNavigationError(
    error: unknown,
    agentOutput: AgentOutput<NavigatorResult>,
  ): AgentOutput<NavigatorResult> {
    this.removeLastStateMessageFromMemory();

    // Handle specific error types
    if (isAuthenticationError(error)) {
      throw new ChatModelAuthError('Navigator API Authentication failed. Please verify your API key', error);
    }
    if (isForbiddenError(error)) {
      throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
    }
    if (isAbortedError(error)) {
      throw new RequestCancelledError((error as Error).message);
    }
    if (error instanceof URLNotAllowedError) {
      throw error;
    }

    // Handle general errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorString = `Navigation failed: ${errorMessage}`;
    logger.error(errorString);

    const errorDetails = {
      error: errorMessage,
      errorStack: error instanceof Error ? error.stack : undefined,
    };

    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_FAIL, errorString, undefined, errorDetails);
    agentOutput.error = errorMessage;
    return agentOutput;
  }

  /**
   * Handle navigation cancellation
   */
  private handleCancellation(): void {
    this.removeLastStateMessageFromMemory();
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_CANCEL, 'Navigation cancelled', undefined, {
      status: 'cancelled',
    });
  }

  /**
   * Add the state message to the memory
   */
  public async addStateMessageToMemory() {
    if (this.context.stateMessageAdded) {
      return;
    }

    const messageManager = this.context.messageManager;
    // Handle results that should be included in memory
    if (this.context.actionResults.length > 0) {
      let index = 0;
      for (const r of this.context.actionResults) {
        if (r.includeInMemory) {
          if (r.extractedContent) {
            const msg = new HumanMessage(`Action result: ${r.extractedContent}`);
            // logger.info('Adding action result to memory', msg.content);
            messageManager.addMessageWithTokens(msg);
          }
          if (r.error) {
            // Get error text and convert to string
            const errorText = r.error.toString().trim();

            // Get only the last line of the error
            const lastLine = errorText.split('\n').pop() || '';

            const msg = new HumanMessage(`Action error: ${lastLine}`);
            logger.info('Adding action error to memory', msg.content);
            messageManager.addMessageWithTokens(msg);
          }
          // reset this action result to empty, we dont want to add it again in the state message
          // NOTE: in python version, all action results are reset to empty, but in ts version, only those included in memory are reset to empty
          this.context.actionResults[index] = new ActionResult();
        }
        index++;
      }
    }

    const state = await this.prompt.getUserMessage(this.context);
    messageManager.addStateMessage(state);
    this.context.stateMessageAdded = true;
  }

  /**
   * Remove the last state message from the memory
   */
  protected async removeLastStateMessageFromMemory() {
    if (!this.context.stateMessageAdded) return;
    const messageManager = this.context.messageManager;
    messageManager.removeLastStateMessage();
    this.context.stateMessageAdded = false;
  }

  private async addModelOutputToMemory(modelOutput: this['ModelOutput']) {
    const messageManager = this.context.messageManager;
    messageManager.addModelOutput(modelOutput);
  }

  private async doMultiAction(response: this['ModelOutput']): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    let errCount = 0;

    logger.info('Actions', response.action);
    // sometimes response.action is a string, but not an array as expected, so we need to parse it as an array
    let actions: Record<string, unknown>[] = [];
    if (Array.isArray(response.action)) {
      // if the item is null, skip it
      actions = response.action.filter((item: unknown) => item !== null);
      if (actions.length === 0) {
        logger.warning('No valid actions found', response.action);
      }
    } else if (typeof response.action === 'string') {
      try {
        logger.warning('Unexpected action format', response.action);
        // try to parse the action as an JSON object
        actions = JSON.parse(response.action);
      } catch (error) {
        logger.error('Invalid action format', response.action);
        throw new Error('Invalid action output format');
      }
    } else {
      // if the action is neither an array nor a string, it should be an object
      actions = [response.action];
    }

    const browserContext = this.context.browserContext;
    const browserState = await browserContext.getState(this.context.options.useVision);
    const cachedPathHashes = await calcBranchPathHashSet(browserState);

    await browserContext.removeHighlight();

    for (const [i, action] of actions.entries()) {
      const actionName = Object.keys(action)[0];
      const actionArgs = action[actionName];
      try {
        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }

        const actionInstance = this.actionRegistry.getAction(actionName);
        if (actionInstance === undefined) {
          throw new Error(`Action ${actionName} not exists`);
        }

        const indexArg = actionInstance.getIndexArg(actionArgs);
        if (i > 0 && indexArg !== null) {
          const newState = await browserContext.getState(this.context.options.useVision);
          const newPathHashes = await calcBranchPathHashSet(newState);
          // next action requires index but there are new elements on the page
          if (!newPathHashes.isSubsetOf(cachedPathHashes)) {
            const msg = `Something new appeared after action ${i} / ${actions.length}`;
            logger.info(msg);
            results.push(
              new ActionResult({
                extractedContent: msg,
                includeInMemory: true,
              }),
            );
            break;
          }
        }

        const result = await actionInstance.call(actionArgs);
        if (result === undefined) {
          throw new Error(`Action ${actionName} returned undefined`);
        }
        results.push(result);
        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }
        // TODO: wait for 1 second for now, need to optimize this to avoid unnecessary waiting
        await new Promise(resolve => setTimeout(resolve, CONSTANTS.ACTION_WAIT_TIME));
      } catch (error) {
        if (error instanceof URLNotAllowedError) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('doAction error', actionName, actionArgs, errorMessage);
        // unexpected error, emit event
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMessage);
        errCount++;
        if (errCount > CONSTANTS.MAX_ACTION_ERRORS) {
          throw new Error('Too many errors in actions');
        }
        results.push(
          new ActionResult({
            error: errorMessage,
            isDone: false,
            includeInMemory: true,
          }),
        );
      }
    }
    return results;
  }

  /**
   * Analyze current action context with enhanced information
   */
  private analyzeCurrentAction(
    browserState: EnhancedBrowserState & { interactiveElementsCount: number },
    taskInstruction: string,
    nextPlanStep: string,
  ): string {
    try {
      const pageTitle = browserState.title || CONSTANTS.DEFAULT_MESSAGES.UNKNOWN_PAGE;
      const pageUrl = browserState.url || CONSTANTS.DEFAULT_MESSAGES.UNKNOWN_PAGE;
      const elementCount = browserState.interactiveElementsCount;

      let analysis = `🌐 Currently on: "${pageTitle}"\n`;
      analysis += `📍 URL: ${pageUrl}\n`;
      analysis += `🎯 Found ${elementCount} interactive elements available for action.\n`;

      // Basic page state guidance (no hardcoded patterns)
      if (elementCount === 0) {
        analysis += `⚠️ CRITICAL: No interactive elements detected! `;
        if (browserState.pixelsBelow > 0) {
          analysis += `Page has content below - try scrolling down to reveal more elements.\n`;
        } else {
          analysis += `Page may not have loaded properly - try waiting or refreshing.\n`;
        }
      }

      // Basic scroll availability info
      const hasContentBelow = browserState.pixelsBelow > 0;
      const hasContentAbove = browserState.pixelsAbove > 0;

      if (hasContentBelow) {
        analysis += `📜 Content available below (${browserState.pixelsBelow}px) - scrolling may reveal more options.\n`;
      }

      if (hasContentAbove) {
        analysis += `⬆️ Content available above (${browserState.pixelsAbove}px) - can scroll up if needed.\n`;
      }

      if (nextPlanStep !== CONSTANTS.DEFAULT_MESSAGES.NO_NEXT_STEP) {
        analysis += `📋 Next planned action: ${nextPlanStep}`;
      }

      return analysis;
    } catch (error) {
      return CONSTANTS.DEFAULT_MESSAGES.ANALYSIS_ERROR;
    }
  }

  /**
   * Extract task instruction and plan information from message history
   */
  private extractTaskInformation(): TaskInformation {
    const allMessages = this.context.messageManager.getMessages();
    let taskInstruction: string = CONSTANTS.DEFAULT_MESSAGES.TASK_NOT_FOUND;
    let activePlan: string = CONSTANTS.DEFAULT_MESSAGES.PLAN_NOT_FOUND;
    let planSteps: string[] = [];
    let nextPlanStep: string = CONSTANTS.DEFAULT_MESSAGES.NO_NEXT_STEP;

    // Find task instruction
    for (const msg of allMessages) {
      if (
        msg instanceof HumanMessage &&
        typeof msg.content === 'string' &&
        msg.content.startsWith(CONSTANTS.TASK_INSTRUCTION_PREFIX)
      ) {
        taskInstruction = msg.content;
        break;
      }
    }

    // Find latest plan - simplified approach
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msg = allMessages[i];
      if (
        msg instanceof AIMessage &&
        typeof msg.content === 'string' &&
        msg.content.startsWith(CONSTANTS.PLAN_TAG_START)
      ) {
        activePlan = msg.content;

        // Simple plan extraction - just get the raw plan content
        const planMatch = msg.content.match(CONSTANTS.PLAN_TAG_REGEX);
        if (planMatch) {
          const planText = planMatch[1].trim();
          // Let the LLM understand the plan structure instead of complex parsing
          nextPlanStep = `Plan available: ${planText.substring(0, 200)}${planText.length > 200 ? '...' : ''}`;
        }
        break;
      }
    }

    return { taskInstruction, activePlan, planSteps, nextPlanStep };
  }
}
