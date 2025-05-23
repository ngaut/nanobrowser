import { createLogger } from '@src/infrastructure/monitoring/logger';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AgentContext, type AgentOptions } from '@src/background/agent/types';
import { NavigatorAgent, NavigatorActionRegistry } from '@src/background/agent/agents/navigator';
import { PlannerAgent } from '@src/background/agent/agents/planner';
import { ValidatorAgent } from '@src/background/agent/agents/validator';
import { NavigatorPrompt } from '@src/background/agent/prompts/navigator';
import { PlannerPrompt } from '@src/background/agent/prompts/planner';
import { ValidatorPrompt } from '@src/background/agent/prompts/validator';
import { ActionFactory } from '@src/infrastructure/actions/action-factory';
import type BrowserContext from '@src/background/browser/context';
import MessageManager from '@src/background/agent/messages/service';
import { EventManager } from '@src/background/agent/event/manager';
import { ConfigurationError } from '@src/shared/types/errors';

const logger = createLogger('AgentFactory');

/**
 * Configuration for creating agents
 */
export interface AgentFactoryConfig {
  task: string;
  taskId: string;
  browserContext: BrowserContext;
  navigatorLLM: BaseChatModel;
  plannerLLM?: BaseChatModel;
  validatorLLM?: BaseChatModel;
  extractorLLM?: BaseChatModel;
  agentOptions?: Partial<AgentOptions>;
}

/**
 * Collection of created agents
 */
export interface AgentCollection {
  navigator: NavigatorAgent;
  planner?: PlannerAgent;
  validator?: ValidatorAgent;
  context: AgentContext;
}

/**
 * Factory for creating and configuring agents
 */
export class AgentFactory {
  private config: AgentFactoryConfig;

  constructor(config: AgentFactoryConfig) {
    this.config = config;
  }

  /**
   * Create all agents with proper configuration
   */
  createAgents(): AgentCollection {
    logger.info('Creating agent collection', {
      taskId: this.config.taskId,
      hasPlanner: !!this.config.plannerLLM,
      hasValidator: !!this.config.validatorLLM,
    });

    // Create core infrastructure
    const context = this.createAgentContext();
    const prompts = this.createPrompts(context);
    const actionFactory = this.createActionFactory(context);

    // Create agents
    const navigator = this.createNavigator(context, prompts.navigator, actionFactory);
    const planner = this.config.plannerLLM ? this.createPlanner(context, prompts.planner) : undefined;
    const validator = this.config.validatorLLM ? this.createValidator(context, prompts.validator) : undefined;

    // Initialize message history
    context.messageManager.initTaskMessages(prompts.navigator.getSystemMessage(), this.config.task);

    logger.debug('Agent collection created successfully', {
      taskId: this.config.taskId,
      hasNavigator: !!navigator,
      hasPlanner: !!planner,
      hasValidator: !!validator,
    });

    return {
      navigator,
      planner,
      validator,
      context,
    };
  }

  /**
   * Create agent context
   */
  private createAgentContext(): AgentContext {
    const messageManager = new MessageManager();
    const eventManager = new EventManager();

    return new AgentContext(
      this.config.taskId,
      this.config.browserContext,
      messageManager,
      eventManager,
      this.config.agentOptions ?? {},
    );
  }

  /**
   * Create prompts for all agents
   */
  private createPrompts(context: AgentContext): {
    navigator: NavigatorPrompt;
    planner: PlannerPrompt;
    validator: ValidatorPrompt;
  } {
    const navigatorPrompt = new NavigatorPrompt(context.options.maxActionsPerStep);
    const plannerPrompt = new PlannerPrompt();
    const validatorPrompt = new ValidatorPrompt(this.config.task);

    return {
      navigator: navigatorPrompt,
      planner: plannerPrompt,
      validator: validatorPrompt,
    };
  }

  /**
   * Create action factory for the agents
   */
  private createActionFactory(context: AgentContext): ActionFactory {
    const extractorLLM = this.config.extractorLLM || this.config.navigatorLLM;
    return new ActionFactory(context, extractorLLM);
  }

  /**
   * Create navigator agent
   */
  private createNavigator(
    context: AgentContext,
    prompt: NavigatorPrompt,
    actionFactory: ActionFactory,
  ): NavigatorAgent {
    const actionRegistry = new NavigatorActionRegistry(actionFactory.buildDefaultActions());

    return new NavigatorAgent(actionRegistry, {
      chatLLM: this.config.navigatorLLM,
      context,
      prompt,
    });
  }

  /**
   * Create planner agent
   */
  private createPlanner(context: AgentContext, prompt: PlannerPrompt): PlannerAgent {
    if (!this.config.plannerLLM) {
      throw new ConfigurationError('Planner LLM is required to create planner agent');
    }

    return new PlannerAgent({
      chatLLM: this.config.plannerLLM,
      context,
      prompt,
    });
  }

  /**
   * Create validator agent
   */
  private createValidator(context: AgentContext, prompt: ValidatorPrompt): ValidatorAgent {
    if (!this.config.validatorLLM) {
      throw new ConfigurationError('Validator LLM is required to create validator agent');
    }

    return new ValidatorAgent({
      chatLLM: this.config.validatorLLM,
      context,
      prompt,
    });
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<AgentFactoryConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.debug('Agent factory configuration updated', { updates });
  }

  /**
   * Create a new factory with updated configuration
   */
  withConfig(updates: Partial<AgentFactoryConfig>): AgentFactory {
    return new AgentFactory({ ...this.config, ...updates });
  }

  /**
   * Get current configuration
   */
  getConfig(): AgentFactoryConfig {
    return { ...this.config };
  }
}
