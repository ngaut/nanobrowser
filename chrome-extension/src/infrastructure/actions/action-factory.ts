import { z } from 'zod';
import type { AgentContext } from '@src/background/agent/types';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseAction } from './base-action';

// Import action categories
import {
  GoToUrlAction,
  SearchGoogleAction,
  GoBackAction,
  OpenTabAction,
  SwitchTabAction,
  CloseTabAction,
} from './navigation-actions';

import {
  ClickElementAction,
  InputTextAction,
  SendKeysAction,
  GetDropdownOptionsAction,
  SelectDropdownOptionAction,
} from './element-actions';

import {
  ScrollDownAction,
  ScrollUpAction,
  ScrollToTextAction,
  WaitAction,
  CacheContentAction,
  DoneAction,
} from './page-actions';

/**
 * Legacy Action wrapper for backward compatibility
 */
export class Action {
  constructor(private readonly baseAction: BaseAction) {}

  async call(input: unknown) {
    return await this.baseAction.call(input);
  }

  name(): string {
    return this.baseAction.name();
  }

  prompt(): string {
    return this.baseAction.prompt();
  }

  getIndexArg(input: unknown): number | null {
    return this.baseAction.getIndexArg(input);
  }

  get schema() {
    return this.baseAction.schema;
  }

  get hasIndex() {
    return this.baseAction.hasIndex;
  }
}

/**
 * Action Factory that creates and manages all available actions
 */
export class ActionFactory {
  private readonly context: AgentContext;
  private readonly extractorLLM: BaseChatModel;

  constructor(context: AgentContext, extractorLLM: BaseChatModel) {
    this.context = context;
    this.extractorLLM = extractorLLM;
  }

  /**
   * Build all default actions organized by category
   */
  buildDefaultActions(): Action[] {
    const actions: Action[] = [];

    // Navigation Actions
    actions.push(new Action(new GoToUrlAction(this.context)));
    actions.push(new Action(new SearchGoogleAction(this.context)));
    actions.push(new Action(new GoBackAction(this.context)));
    actions.push(new Action(new OpenTabAction(this.context)));
    actions.push(new Action(new SwitchTabAction(this.context)));
    actions.push(new Action(new CloseTabAction(this.context)));

    // Element Interaction Actions
    actions.push(new Action(new ClickElementAction(this.context)));
    actions.push(new Action(new InputTextAction(this.context)));
    actions.push(new Action(new SendKeysAction(this.context)));
    actions.push(new Action(new GetDropdownOptionsAction(this.context)));
    actions.push(new Action(new SelectDropdownOptionAction(this.context)));

    // Page Control Actions
    actions.push(new Action(new ScrollDownAction(this.context)));
    actions.push(new Action(new ScrollUpAction(this.context)));
    actions.push(new Action(new ScrollToTextAction(this.context)));
    actions.push(new Action(new WaitAction(this.context)));
    actions.push(new Action(new CacheContentAction(this.context)));

    // Task Completion
    actions.push(new Action(new DoneAction(this.context)));

    return actions;
  }

  /**
   * Build navigation-only actions
   */
  buildNavigationActions(): Action[] {
    return [
      new Action(new GoToUrlAction(this.context)),
      new Action(new SearchGoogleAction(this.context)),
      new Action(new GoBackAction(this.context)),
      new Action(new OpenTabAction(this.context)),
      new Action(new SwitchTabAction(this.context)),
      new Action(new CloseTabAction(this.context)),
    ];
  }

  /**
   * Build element interaction actions
   */
  buildElementActions(): Action[] {
    return [
      new Action(new ClickElementAction(this.context)),
      new Action(new InputTextAction(this.context)),
      new Action(new SendKeysAction(this.context)),
      new Action(new GetDropdownOptionsAction(this.context)),
      new Action(new SelectDropdownOptionAction(this.context)),
    ];
  }

  /**
   * Build page control actions
   */
  buildPageActions(): Action[] {
    return [
      new Action(new ScrollDownAction(this.context)),
      new Action(new ScrollUpAction(this.context)),
      new Action(new ScrollToTextAction(this.context)),
      new Action(new WaitAction(this.context)),
      new Action(new CacheContentAction(this.context)),
    ];
  }

  /**
   * Build custom action set based on requirements
   */
  buildCustomActions(categories: ('navigation' | 'element' | 'page' | 'completion')[]): Action[] {
    const actions: Action[] = [];

    for (const category of categories) {
      switch (category) {
        case 'navigation':
          actions.push(...this.buildNavigationActions());
          break;
        case 'element':
          actions.push(...this.buildElementActions());
          break;
        case 'page':
          actions.push(...this.buildPageActions());
          break;
        case 'completion':
          actions.push(new Action(new DoneAction(this.context)));
          break;
      }
    }

    return actions;
  }
}

/**
 * Build dynamic action schema for Zod validation
 */
export function buildDynamicActionSchema(actions: Action[]): z.ZodType {
  let schema = z.object({});
  for (const action of actions) {
    const actionSchema = action.schema.schema.nullable().describe(action.schema.description);
    schema = schema.extend({
      [action.name()]: actionSchema,
    });
  }
  return schema.partial();
}
