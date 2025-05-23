import { z } from 'zod';
import { BaseAction } from './base-action';
import { ActionResult, type AgentContext } from '@src/background/agent/types';
import {
  clickElementActionSchema,
  inputTextActionSchema,
  sendKeysActionSchema,
  selectDropdownOptionActionSchema,
  getDropdownOptionsActionSchema,
} from '@src/background/agent/actions/schemas';

/**
 * Click on a DOM element
 */
export class ClickElementAction extends BaseAction<z.infer<typeof clickElementActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, clickElementActionSchema, true); // has index
  }

  protected getBaseDetail(input: z.infer<typeof clickElementActionSchema.schema>): string {
    return `Clicking element at index ${input.index}`;
  }

  protected async execute(input: z.infer<typeof clickElementActionSchema.schema>): Promise<ActionResult> {
    const page = await this.context.browserContext.getCurrentPage();
    const elementNode = page.getDomElementByIndex(input.index);

    if (!elementNode) {
      const errorMsg = `Element with index ${input.index} not found`;
      return this.createErrorResult(errorMsg);
    }

    try {
      await page.clickElementNode(this.context.useVision, elementNode);
      const message = `Clicked element at index ${input.index}`;
      return this.createSuccessResult(message);
    } catch (error) {
      const errorMsg = `Failed to click element at index ${input.index}: ${error instanceof Error ? error.message : String(error)}`;
      return this.createErrorResult(errorMsg);
    }
  }
}

/**
 * Input text into a form element
 */
export class InputTextAction extends BaseAction<z.infer<typeof inputTextActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, inputTextActionSchema, true); // has index
  }

  protected getBaseDetail(input: z.infer<typeof inputTextActionSchema.schema>): string {
    return `Inputting text "${input.text}" into element at index ${input.index}`;
  }

  protected async execute(input: z.infer<typeof inputTextActionSchema.schema>): Promise<ActionResult> {
    const page = await this.context.browserContext.getCurrentPage();
    const elementNode = page.getDomElementByIndex(input.index);

    if (!elementNode) {
      const errorMsg = `Element with index ${input.index} not found`;
      return this.createErrorResult(errorMsg);
    }

    try {
      await page.inputTextElementNode(this.context.useVision, elementNode, input.text);
      const message = `Input text "${input.text}" into element at index ${input.index}`;
      return this.createSuccessResult(message);
    } catch (error) {
      const errorMsg = `Failed to input text into element at index ${input.index}: ${error instanceof Error ? error.message : String(error)}`;
      return this.createErrorResult(errorMsg);
    }
  }
}

/**
 * Send keyboard keys
 */
export class SendKeysAction extends BaseAction<z.infer<typeof sendKeysActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, sendKeysActionSchema);
  }

  protected getBaseDetail(input: z.infer<typeof sendKeysActionSchema.schema>): string {
    return `Sending keys: ${input.keys}`;
  }

  protected async execute(input: z.infer<typeof sendKeysActionSchema.schema>): Promise<ActionResult> {
    try {
      const page = await this.context.browserContext.getCurrentPage();
      await page.sendKeys(input.keys);
      const message = `Sent keys: ${input.keys}`;
      return this.createSuccessResult(message);
    } catch (error) {
      const errorMsg = `Failed to send keys "${input.keys}": ${error instanceof Error ? error.message : String(error)}`;
      return this.createErrorResult(errorMsg);
    }
  }
}

/**
 * Get dropdown options
 */
export class GetDropdownOptionsAction extends BaseAction<z.infer<typeof getDropdownOptionsActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, getDropdownOptionsActionSchema, true); // has index
  }

  protected getBaseDetail(input: z.infer<typeof getDropdownOptionsActionSchema.schema>): string {
    return `Getting dropdown options for element at index ${input.index}`;
  }

  protected async execute(input: z.infer<typeof getDropdownOptionsActionSchema.schema>): Promise<ActionResult> {
    const page = await this.context.browserContext.getCurrentPage();
    const elementNode = page.getDomElementByIndex(input.index);

    if (!elementNode) {
      const errorMsg = `Element with index ${input.index} not found`;
      return this.createErrorResult(errorMsg);
    }

    try {
      const options = await page.getDropdownOptions(input.index);
      const optionsText = options.map(opt => `${opt.index}: ${opt.text}`).join(', ');
      const message = `Dropdown options for element ${input.index}: ${optionsText}`;

      return new ActionResult({
        extractedContent: message,
        includeInMemory: true,
        data: options,
      });
    } catch (error) {
      const errorMsg = `Failed to get dropdown options for element at index ${input.index}: ${error instanceof Error ? error.message : String(error)}`;
      return this.createErrorResult(errorMsg);
    }
  }
}

/**
 * Select dropdown option
 */
export class SelectDropdownOptionAction extends BaseAction<z.infer<typeof selectDropdownOptionActionSchema.schema>> {
  constructor(context: AgentContext) {
    super(context, selectDropdownOptionActionSchema, true); // has index
  }

  protected getBaseDetail(input: z.infer<typeof selectDropdownOptionActionSchema.schema>): string {
    return `Selecting option "${input.text}" from dropdown at index ${input.index}`;
  }

  protected async execute(input: z.infer<typeof selectDropdownOptionActionSchema.schema>): Promise<ActionResult> {
    const page = await this.context.browserContext.getCurrentPage();
    const elementNode = page.getDomElementByIndex(input.index);

    if (!elementNode) {
      const errorMsg = `Element with index ${input.index} not found`;
      return this.createErrorResult(errorMsg);
    }

    try {
      const result = await page.selectDropdownOption(input.index, input.text);
      return this.createSuccessResult(result);
    } catch (error) {
      const errorMsg = `Failed to select dropdown option "${input.text}" at index ${input.index}: ${error instanceof Error ? error.message : String(error)}`;
      return this.createErrorResult(errorMsg);
    }
  }
}
