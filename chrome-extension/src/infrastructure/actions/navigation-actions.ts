import { z } from 'zod';
import { BaseAction } from './base-action';
import { ActionResult, type AgentContext } from '@src/background/agent/types';
import {
  goToUrlActionSchema,
  searchGoogleActionSchema,
  goBackActionSchema,
  openTabActionSchema,
  switchTabActionSchema,
  closeTabActionSchema,
} from '@src/background/agent/actions/schemas';

/**
 * Navigate to a specific URL
 */
export class GoToUrlAction extends BaseAction<z.infer<typeof goToUrlActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, goToUrlActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof goToUrlActionSchema.schema>): string {
    return `Navigating to ${input.url}`;
  }

  protected async execute(input: z.infer<typeof goToUrlActionSchema.schema>): Promise<ActionResult> {
    await this.context.browserContext.navigateTo(input.url);
    const message = `Navigated to ${input.url}`;
    return this.createSuccessResult(message);
  }
}

/**
 * Search on Google
 */
export class SearchGoogleAction extends BaseAction<z.infer<typeof searchGoogleActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, searchGoogleActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof searchGoogleActionSchema.schema>): string {
    return `Searching for "${input.query}" in Google`;
  }

  protected async execute(input: z.infer<typeof searchGoogleActionSchema.schema>): Promise<ActionResult> {
    await this.context.browserContext.navigateTo(`https://www.google.com/search?q=${input.query}`);
    const message = `Searched for "${input.query}" in Google`;
    return this.createSuccessResult(message);
  }
}

/**
 * Go back in browser history
 */
export class GoBackAction extends BaseAction<z.infer<typeof goBackActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, goBackActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof goBackActionSchema.schema>): string {
    return 'Going back in browser history';
  }

  protected async execute(input: z.infer<typeof goBackActionSchema.schema>): Promise<ActionResult> {
    const page = await this.context.browserContext.getCurrentPage();
    await page.goBack();
    const message = 'Went back in browser history';
    return this.createSuccessResult(message);
  }
}

/**
 * Open a new tab
 */
export class OpenTabAction extends BaseAction<z.infer<typeof openTabActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, openTabActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof openTabActionSchema.schema>): string {
    return `Opening new tab with URL: ${input.url}`;
  }

  protected async execute(input: z.infer<typeof openTabActionSchema.schema>): Promise<ActionResult> {
    await this.context.browserContext.openTab(input.url);
    const message = `Opened new tab with URL: ${input.url}`;
    return this.createSuccessResult(message);
  }
}

/**
 * Switch to a different tab
 */
export class SwitchTabAction extends BaseAction<z.infer<typeof switchTabActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, switchTabActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof switchTabActionSchema.schema>): string {
    return `Switching to tab ${input.tabId}`;
  }

  protected async execute(input: z.infer<typeof switchTabActionSchema.schema>): Promise<ActionResult> {
    await this.context.browserContext.switchTab(input.tabId);
    const message = `Switched to tab ${input.tabId}`;
    return this.createSuccessResult(message);
  }
}

/**
 * Close a tab
 */
export class CloseTabAction extends BaseAction<z.infer<typeof closeTabActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, closeTabActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof closeTabActionSchema.schema>): string {
    return `Closing tab ${input.tabId}`;
  }

  protected async execute(input: z.infer<typeof closeTabActionSchema.schema>): Promise<ActionResult> {
    await this.context.browserContext.closeTab(input.tabId);
    const message = `Closed tab ${input.tabId}`;
    return this.createSuccessResult(message);
  }
}
