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
  pageElements: string; // NEW: Page elements context from Planner
}

interface EnhancedBrowserState {
  title: string;
  url: string;
  tabId: number;
  elementTree: any;
  tabs: any[];
  pixelsAbove: number;
  pixelsBelow: number;
  screenshot: string | null; // Base64 encoded screenshot, matching BrowserState type
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
    screenshot: string | null; // Base64 encoded screenshot
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
    currentPlanStep: number;
    planCreatedAtStep: number;
    stepsSincePlanCreated: number;
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
  // Navigator's reasoning from current_state
  reasoning?: {
    evaluation_previous_goal: string;
    reasoning: string;
    memory: string;
    next_goal: string;
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
        logger.info('🔧 Navigator invoking structured LLM with schema:', {
          modelName: this.modelName,
          toolName: this.modelOutputToolName,
          schemaKeys: Object.keys(this.jsonSchema.properties || {}),
          fullSchema: JSON.stringify(this.jsonSchema, null, 2),
        });

        response = await structuredLlm.invoke(inputMessages, {
          signal: this.context.controller.signal,
          ...this.callOptions,
        });

        logger.info('🔧 Navigator structured LLM response - FULL TRACE:', {
          hasParsed: !!response.parsed,
          hasRaw: !!response.raw,
          rawType: response.raw?.constructor?.name,
          fullParsedResponse: response.parsed ? JSON.stringify(response.parsed, null, 2) : null,
          fullRawResponse: response.raw ? JSON.stringify(response.raw, null, 2) : null,
        });

        if (response.parsed) {
          logger.info('✅ Navigator parsed response successfully:', {
            hasCurrentState: !!response.parsed.current_state,
            hasAction: !!response.parsed.action,
            actionCount: response.parsed.action?.length || 0,
          });
          return response.parsed;
        }
      } catch (error) {
        if (isAbortedError(error)) {
          throw error;
        }
        logger.error('❌ Navigator structured output failed:', {
          error: error instanceof Error ? error.message : String(error),
          modelName: this.modelName,
          errorType: error instanceof Error ? error.constructor.name : typeof error,
        });
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

      logger.info('🔧 Navigator checking raw response for tool calls:', {
        hasToolCalls: !!rawResponse.tool_calls,
        toolCallsCount: rawResponse.tool_calls?.length || 0,
        content: rawResponse.content?.toString().substring(0, 200) + '...',
      });

      // sometimes LLM returns an empty content, but with one or more tool calls, so we need to check the tool calls
      if (rawResponse.tool_calls && rawResponse.tool_calls.length > 0) {
        logger.info('✅ Navigator using tool call fallback:', {
          toolCallsCount: rawResponse.tool_calls.length,
          firstToolCall: rawResponse.tool_calls[0],
        });
        // only use the first tool call
        const toolCall = rawResponse.tool_calls[0];
        return {
          current_state: toolCall.args.currentState,
          action: [...toolCall.args.action],
        };
      }

      logger.error('❌ Navigator could not parse response - no parsed output or tool calls');
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

      // Create a more informative details string from the action analysis
      const detailsString = enhancedDetails.actionAnalysis || 'Navigating...';

      this.context.emitEvent(
        Actors.NAVIGATOR,
        ExecutionState.STEP_START,
        detailsString,
        enhancedDetails as unknown as Record<string, unknown>,
        undefined,
      );

      // Store current context for action reasoning
      this.context.currentNavigatorContext = {
        taskInstruction: taskInfo.taskInstruction,
        activePlan: taskInfo.activePlan,
        nextPlanStep: taskInfo.nextPlanStep,
        currentPlanStep: taskInfo.currentPlanStep,
        availableElements: browserState.interactiveElementsCount,
        pageContext: {
          title: browserState.title || 'Unknown',
          url: browserState.url || 'Unknown',
        },
        pageElements: taskInfo.pageElements, // NEW: Include Planner's page elements context
      };

      // Execute navigation logic
      const result = await this.executeNavigationStep();
      if (result.cancelled) {
        cancelled = true;
        return agentOutput;
      }

      // Always emit STEP_OK event with reasoning if available
      const enhancedDetailsWithReasoning = {
        ...enhancedDetails,
        reasoning: result.reasoning,
      };

      this.context.emitEvent(
        Actors.NAVIGATOR,
        ExecutionState.STEP_OK,
        result.reasoning ? 'Navigation completed with reasoning' : 'Navigation completed',
        enhancedDetailsWithReasoning as unknown as Record<string, unknown>,
        this.context.actionResults,
      );

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
    taskInfo: TaskInformation & {
      planCreatedAtStep: number;
      stepsSincePlanCreated: number;
      currentPlanStep: number;
    },
    browserState: EnhancedBrowserState & { interactiveElementsCount: number },
  ): NavigatorDetails {
    const actionAnalysis = this.analyzeCurrentAction(
      browserState,
      taskInfo.taskInstruction,
      taskInfo.nextPlanStep,
      taskInfo.pageElements,
    );

    const currentPageInfo = {
      title: browserState.title || CONSTANTS.DEFAULT_MESSAGES.UNKNOWN_PAGE,
      url: browserState.url || CONSTANTS.DEFAULT_MESSAGES.UNKNOWN_PAGE,
      tabId: browserState.tabId,
      screenshot: browserState.screenshot, // Include screenshot (string | null)
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
        currentPlanStep: taskInfo.currentPlanStep,
        planCreatedAtStep: taskInfo.planCreatedAtStep,
        stepsSincePlanCreated: taskInfo.stepsSincePlanCreated,
      },

      actionAnalysis,

      temporalContext: {
        stepNumber: this.context.nSteps + 1,
        maxSteps: this.context.options.maxSteps,
        progressPercentage: Math.round(((this.context.nSteps + 1) / this.context.options.maxSteps) * 100),
        executionStartTime: this.context.executionStartTime,
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
  private async executeNavigationStep(): Promise<{ done: boolean; cancelled: boolean; reasoning?: any }> {
    // Add browser state to memory
    await this.addStateMessageToMemory();

    if (this.context.paused || this.context.stopped) {
      return { done: false, cancelled: true };
    }

    // Check for recent user context and incorporate it
    const userContext = this.context.messageManager.getRecentUserContext();
    if (userContext) {
      logger.info('🧠 Incorporating user context:', userContext);
      // The user context is already added to the message history by MessageManager.addUserContext
      // It will be included in the inputMessages below
    }

    // Get LLM response
    const inputMessages = this.context.messageManager.getMessages();

    // Debug: Log COMPLETE LLM input
    logger.infoDetailed('🤖 Navigator LLM Input - FULL TRACE:', {
      messageCount: inputMessages.length,
      modelName: this.modelName,
      withStructuredOutput: this.withStructuredOutput,
    });

    // Navigator processes messages (details already logged by Planner's current state)
    logger.info(`🤖 Navigator processing ${inputMessages.length} messages`);

    // Add timeout and retry logic for LLM invocation
    let modelOutput: this['ModelOutput'] | null = null;
    const maxRetries = 3;
    const timeoutMs = 60000; // 60 seconds timeout

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`🤖 Navigator LLM invocation attempt ${attempt}/${maxRetries}`);

        // Create timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`LLM call timed out after ${timeoutMs}ms`)), timeoutMs);
        });

        // Race between LLM call and timeout
        modelOutput = await Promise.race([this.invoke(inputMessages), timeoutPromise]);

        // Validate model output structure
        if (!modelOutput) {
          throw new Error('LLM returned null/undefined output');
        }

        if (!modelOutput.current_state) {
          throw new Error('LLM output missing current_state field');
        }

        if (!modelOutput.action) {
          throw new Error('LLM output missing action field');
        }

        // Smart logging: Log key output info without full content dump
        logger.info(`🤖 Navigator LLM Output: ${modelOutput.action?.length || 0} actions planned`);
        if (modelOutput.current_state?.next_goal) {
          logger.info(`🎯 Next goal: ${modelOutput.current_state.next_goal}`);
        }

        logger.info(`✅ Navigator LLM invocation successful on attempt ${attempt}`);
        break; // Success, exit retry loop
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`❌ Navigator LLM invocation failed on attempt ${attempt}/${maxRetries}:`, {
          error: errorMessage,
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          attempt,
          maxRetries,
        });

        // If this is the last attempt, throw the error
        if (attempt === maxRetries) {
          throw new Error(`Navigator LLM failed after ${maxRetries} attempts. Last error: ${errorMessage}`);
        }

        // Wait before retry (exponential backoff)
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5 seconds
        logger.info(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Ensure modelOutput was successfully assigned
    if (!modelOutput) {
      throw new Error('Navigator LLM failed to produce valid output after all retry attempts');
    }

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

    // Only log reasoning in debug mode or on errors
    if (modelOutput.current_state?.evaluation_previous_goal?.includes('Failed')) {
      logger.warning(`⚠️ Previous goal failed: ${modelOutput.current_state.evaluation_previous_goal}`);
    }

    return { done, cancelled: false, reasoning: modelOutput.current_state };
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
    pageElements?: string,
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

      // NEW: Include Planner's page elements context if available
      if (pageElements && pageElements.trim().length > 0) {
        analysis += `\n🎯 Planner's element context: ${pageElements}`;
      }

      return analysis;
    } catch (error) {
      return CONSTANTS.DEFAULT_MESSAGES.ANALYSIS_ERROR;
    }
  }

  /**
   * Extract task instruction and plan information from message history
   */
  private extractTaskInformation(): TaskInformation & {
    planCreatedAtStep: number;
    stepsSincePlanCreated: number;
    currentPlanStep: number;
  } {
    const allMessages = this.context.messageManager.getMessages();
    let taskInstruction: string = CONSTANTS.DEFAULT_MESSAGES.TASK_NOT_FOUND;
    let activePlan: string = CONSTANTS.DEFAULT_MESSAGES.PLAN_NOT_FOUND;
    let planSteps: string[] = [];
    let nextPlanStep: string = CONSTANTS.DEFAULT_MESSAGES.NO_NEXT_STEP;
    let pageElements: string = ''; // NEW: Page elements from Planner
    let planCreatedAtStep: number = 0;
    let planMessageIndex: number = -1;

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

    // Find latest plan and its position in message history
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msg = allMessages[i];
      if (
        msg instanceof AIMessage &&
        typeof msg.content === 'string' &&
        msg.content.startsWith(CONSTANTS.PLAN_TAG_START)
      ) {
        activePlan = msg.content;
        planMessageIndex = i;

        // Simple plan extraction - just get the raw plan content
        const planMatch = msg.content.match(CONSTANTS.PLAN_TAG_REGEX);
        if (planMatch) {
          const planText = planMatch[1].trim();

          // Extract plan steps from the plan text
          try {
            const planData = JSON.parse(planText);
            if (planData.next_steps && typeof planData.next_steps === 'string') {
              // Parse numbered steps from next_steps string
              const stepsText = planData.next_steps;
              const stepMatches = stepsText.match(/\d+\.\s*[^.]+\./g);
              if (stepMatches) {
                planSteps = stepMatches.map((step: string) => step.trim());
                nextPlanStep = planSteps[0] || CONSTANTS.DEFAULT_MESSAGES.NO_NEXT_STEP;
              } else {
                // Fallback: split by numbers if no proper format found
                const fallbackSteps = stepsText.split(/\d+\.\s*/).filter((step: string) => step.trim().length > 0);
                if (fallbackSteps.length > 0) {
                  planSteps = fallbackSteps.map((step: string, index: number) => `${index + 1}. ${step.trim()}`);
                  nextPlanStep = planSteps[0] || CONSTANTS.DEFAULT_MESSAGES.NO_NEXT_STEP;
                }
              }
            }
            // NEW: Extract page elements context from Planner
            if (planData.page_elements && typeof planData.page_elements === 'string') {
              pageElements = planData.page_elements;
              logger.infoDetailed('✅ Extracted page_elements from Planner:', {
                length: pageElements.length,
                preview: pageElements.substring(0, 200) + '...',
                elementCount: (pageElements.match(/\[\d+\]/g) || []).length,
                fullPageElements: pageElements,
              });
            } else {
              logger.infoDetailed('❌ No page_elements found in planData:', {
                availableKeys: Object.keys(planData),
                hasPageElements: 'page_elements' in planData,
                pageElementsType: typeof planData.page_elements,
                pageElementsValue: planData.page_elements,
                fullPlanData: planData,
              });
            }
          } catch (error) {
            // If JSON parsing fails, try to extract steps from raw text
            const stepMatches = planText.match(/\d+\.\s*[^.]+\./g);
            if (stepMatches) {
              planSteps = stepMatches.map((step: string) => step.trim());
              nextPlanStep = planSteps[0] || CONSTANTS.DEFAULT_MESSAGES.NO_NEXT_STEP;
            }
          }

          // Fallback for nextPlanStep if no steps were extracted
          if (nextPlanStep === CONSTANTS.DEFAULT_MESSAGES.NO_NEXT_STEP) {
            nextPlanStep = `Plan available: ${planText.substring(0, 200)}${planText.length > 200 ? '...' : ''}`;
          }
        }
        break;
      }
    }

    // Calculate when the plan was created and current progress within that plan
    if (planMessageIndex >= 0) {
      // Estimate the step when the plan was created based on message history
      // Plans are typically created every planningInterval steps
      const messagesBeforePlan = planMessageIndex;
      // Rough estimation: each planning cycle adds ~2-3 messages (state + plan)
      planCreatedAtStep = Math.floor(messagesBeforePlan / 3) * this.context.options.planningInterval;
    }

    const stepsSincePlanCreated = Math.max(0, this.context.nSteps - planCreatedAtStep);

    // Calculate current step within the plan
    // If we have plan steps, determine which step we're currently on
    let currentPlanStep = 1;
    if (planSteps.length > 0) {
      // Each plan step might take multiple Navigator steps to complete
      // Use a simple heuristic: assume each plan step takes 1-2 Navigator steps
      const stepsPerPlanStep = Math.max(
        1,
        Math.floor(this.context.options.planningInterval / Math.max(1, planSteps.length)),
      );
      currentPlanStep = Math.min(planSteps.length, Math.floor(stepsSincePlanCreated / stepsPerPlanStep) + 1);
    }

    return {
      taskInstruction,
      activePlan,
      planSteps,
      nextPlanStep,
      pageElements,
      planCreatedAtStep,
      stepsSincePlanCreated,
      currentPlanStep,
    };
  }
}
