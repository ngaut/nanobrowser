import { z } from 'zod';
import { BaseAction } from './base-action';
import { ActionResult, type AgentContext } from '@src/background/agent/types';
import {
  scrollDownActionSchema,
  scrollUpActionSchema,
  scrollToTextActionSchema,
  waitActionSchema,
  cacheContentActionSchema,
  doneActionSchema,
} from '@src/background/agent/actions/schemas';

/**
 * Scroll page down
 */
export class ScrollDownAction extends BaseAction<z.infer<typeof scrollDownActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, scrollDownActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof scrollDownActionSchema.schema>): string {
    return input.amount ? `Scrolling down by ${input.amount} pixels` : 'Scrolling down';
  }

  protected async execute(input: z.infer<typeof scrollDownActionSchema.schema>): Promise<ActionResult> {
    try {
      const page = await this.context.browserContext.getCurrentPage();
      await page.scrollDown(input.amount);
      const message = input.amount ? `Scrolled down by ${input.amount} pixels` : 'Scrolled down';
      return this.createSuccessResult(message);
    } catch (error) {
      const errorMsg = `Failed to scroll down: ${error instanceof Error ? error.message : String(error)}`;
      return this.createErrorResult(errorMsg);
    }
  }
}

/**
 * Scroll page up
 */
export class ScrollUpAction extends BaseAction<z.infer<typeof scrollUpActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, scrollUpActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof scrollUpActionSchema.schema>): string {
    return input.amount ? `Scrolling up by ${input.amount} pixels` : 'Scrolling up';
  }

  protected async execute(input: z.infer<typeof scrollUpActionSchema.schema>): Promise<ActionResult> {
    try {
      const page = await this.context.browserContext.getCurrentPage();
      await page.scrollUp(input.amount);
      const message = input.amount ? `Scrolled up by ${input.amount} pixels` : 'Scrolled up';
      return this.createSuccessResult(message);
    } catch (error) {
      const errorMsg = `Failed to scroll up: ${error instanceof Error ? error.message : String(error)}`;
      return this.createErrorResult(errorMsg);
    }
  }
}

/**
 * Scroll to specific text on the page
 */
export class ScrollToTextAction extends BaseAction<z.infer<typeof scrollToTextActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, scrollToTextActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof scrollToTextActionSchema.schema>): string {
    return `Scrolling to text: "${input.text}"`;
  }

  protected async execute(input: z.infer<typeof scrollToTextActionSchema.schema>): Promise<ActionResult> {
    try {
      const page = await this.context.browserContext.getCurrentPage();
      const found = await page.scrollToText(input.text);

      if (found) {
        const message = `Scrolled to text: "${input.text}"`;
        return this.createSuccessResult(message);
      } else {
        const message = `Text "${input.text}" not found on page`;
        return this.createErrorResult(message);
      }
    } catch (error) {
      const errorMsg = `Failed to scroll to text "${input.text}": ${error instanceof Error ? error.message : String(error)}`;
      return this.createErrorResult(errorMsg);
    }
  }
}

/**
 * Wait for a specified duration
 */
export class WaitAction extends BaseAction<z.infer<typeof waitActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, waitActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof waitActionSchema.schema>): string {
    return `Waiting for ${input.seconds} seconds`;
  }

  protected async execute(input: z.infer<typeof waitActionSchema.schema>): Promise<ActionResult> {
    try {
      await new Promise(resolve => setTimeout(resolve, input.seconds * 1000));
      const message = `Waited for ${input.seconds} seconds`;
      return this.createSuccessResult(message);
    } catch (error) {
      const errorMsg = `Failed to wait: ${error instanceof Error ? error.message : String(error)}`;
      return this.createErrorResult(errorMsg);
    }
  }
}

/**
 * Cache page content for later use
 */
export class CacheContentAction extends BaseAction<z.infer<typeof cacheContentActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, cacheContentActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof cacheContentActionSchema.schema>): string {
    return `Caching content with key: "${input.key}"`;
  }

  protected async execute(input: z.infer<typeof cacheContentActionSchema.schema>): Promise<ActionResult> {
    try {
      const page = await this.context.browserContext.getCurrentPage();
      const content = await page.getContent();

      // Store in context cache (assuming it exists)
      if (this.context.cache) {
        this.context.cache.set(input.key, content);
      }

      const message = `Cached page content with key: "${input.key}"`;
      return this.createSuccessResult(message);
    } catch (error) {
      const errorMsg = `Failed to cache content: ${error instanceof Error ? error.message : String(error)}`;
      return this.createErrorResult(errorMsg);
    }
  }
}

/**
 * Mark task as completed
 */
export class DoneAction extends BaseAction<z.infer<typeof doneActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, doneActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof doneActionSchema.schema>): string {
    return 'Completing task';
  }

  protected async execute(input: z.infer<typeof doneActionSchema.schema>): Promise<ActionResult> {
    return this.createDoneResult(input.text);
  }
}
