import { ActionResult, type AgentContext } from '@src/background/agent/types';
import {
  clickElementActionSchema,
  doneActionSchema,
  goBackActionSchema,
  goToUrlActionSchema,
  inputTextActionSchema,
  openTabActionSchema,
  refreshPageActionSchema,
  searchGoogleActionSchema,
  switchTabActionSchema,
  type ActionSchema,
  scrollDownActionSchema,
  scrollUpActionSchema,
  sendKeysActionSchema,
  scrollToTextActionSchema,
  cacheContentActionSchema,
  selectDropdownOptionActionSchema,
  getDropdownOptionsActionSchema,
  closeTabActionSchema,
  waitActionSchema,
} from './schemas';
import { z } from 'zod';
import { createLogger } from '@src/background/log';
import { ExecutionState, Actors } from '../event/types';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { wrapUntrustedContent } from '../messages/utils';

const logger = createLogger('Action');

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/**
 * An action is a function that takes an input and returns an ActionResult
 */
export class Action {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly handler: (input: any) => Promise<ActionResult>,
    public readonly schema: ActionSchema,
    // Whether this action has an index argument
    public readonly hasIndex: boolean = false,
  ) {}

  async call(input: unknown): Promise<ActionResult> {
    // Validate input before calling the handler
    const schema = this.schema.schema;

    // check if the schema is schema: z.object({}), if so, ignore the input
    const isEmptySchema =
      schema instanceof z.ZodObject &&
      Object.keys((schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape || {}).length === 0;

    if (isEmptySchema) {
      return await this.handler({});
    }

    const parsedArgs = this.schema.schema.safeParse(input);
    if (!parsedArgs.success) {
      const errorMessage = parsedArgs.error.message;
      throw new InvalidInputError(errorMessage);
    }
    return await this.handler(parsedArgs.data);
  }

  name() {
    return this.schema.name;
  }

  /**
   * Returns the prompt for the action
   * @returns {string} The prompt for the action
   */
  prompt() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schemaShape = (this.schema.schema as z.ZodObject<any>).shape || {};
    const schemaProperties = Object.entries(schemaShape).map(([key, value]) => {
      const zodValue = value as z.ZodTypeAny;
      return `'${key}': {'type': '${zodValue.description}', ${zodValue.isOptional() ? "'optional': true" : "'required': true"}}`;
    });

    const schemaStr =
      schemaProperties.length > 0 ? `{${this.name()}: {${schemaProperties.join(', ')}}}` : `{${this.name()}: {}}`;

    return `${this.schema.description}:\n${schemaStr}`;
  }

  /**
   * Get the index argument from the input if this action has an index
   * @param input The input to extract the index from
   * @returns The index value if found, null otherwise
   */
  getIndexArg(input: unknown): number | null {
    if (!this.hasIndex) {
      return null;
    }
    if (input && typeof input === 'object' && 'index' in input) {
      return (input as { index: number }).index;
    }
    return null;
  }
}

// TODO: can not make every action optional, don't know why
export function buildDynamicActionSchema(actions: Action[]): z.ZodType {
  let schema = z.object({});
  for (const action of actions) {
    // create a schema for the action, it could be action.schema.schema or null
    // but don't use default: null as it causes issues with Google Generative AI
    const actionSchema = action.schema.schema.nullable().describe(action.schema.description);
    schema = schema.extend({
      [action.name()]: actionSchema,
    });
  }
  return schema.partial();
}

export class ActionBuilder {
  private readonly context: AgentContext;
  private readonly extractorLLM: BaseChatModel;

  constructor(context: AgentContext, extractorLLM: BaseChatModel) {
    this.context = context;
    this.extractorLLM = extractorLLM;
  }

  /**
   * Generate reasoning for why a specific element was selected
   */
  private generateSelectionReasoning(elementNode: any, input: any, navigatorContext: any): string {
    if (!navigatorContext) {
      return 'No context available for selection reasoning';
    }

    const reasoning = [];

    // Task context
    if (navigatorContext.nextPlanStep) {
      reasoning.push(`Plan step: "${navigatorContext.nextPlanStep}"`);
    }

    // Element characteristics
    const elementType = elementNode.tagName?.toLowerCase() || 'unknown';
    const elementText = elementNode.getAllTextTillNextClickableElement?.(2)?.trim() || '';
    const elementId = elementNode.attributes?.id || '';
    const elementClass = elementNode.attributes?.class || '';

    reasoning.push(`Selected ${elementType} element [${input.index}]`);

    if (elementText) {
      reasoning.push(`with text: "${elementText}"`);
    }

    if (elementId) {
      reasoning.push(`with ID: "${elementId}"`);
    }

    if (elementClass) {
      reasoning.push(`with class: "${elementClass}"`);
    }

    // Page context
    reasoning.push(`on page: "${navigatorContext.pageContext.title}"`);

    return reasoning.join(' ');
  }

  buildDefaultActions() {
    const actions = [];

    const done = new Action(async (input: z.infer<typeof doneActionSchema.schema>) => {
      const actionName = doneActionSchema.name;
      const baseDetail = 'Completing task';
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;

      // Get current page info for action event
      const currentPageInfo = await this.context.getCurrentPageInfo();
      const actStartDetails = {
        actionName: actionName,
        actionArgs: input,
        currentPage: {
          title: currentPageInfo.title,
          url: currentPageInfo.url,
          tabId: currentPageInfo.tabId,
        },
      };

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, actStartDetails);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Action ${actionName} successful`, undefined, {
        result: input.text,
        currentPage: actStartDetails.currentPage,
      });
      return new ActionResult({
        isDone: true,
        extractedContent: input.text,
      });
    }, doneActionSchema);
    actions.push(done);

    const searchGoogle = new Action(async (input: z.infer<typeof searchGoogleActionSchema.schema>) => {
      const context = this.context;
      const actionName = searchGoogleActionSchema.name;
      const baseDetail = `Searching for "${input.query}" in Google`;
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;

      // Get current page info for action event
      const currentPageInfo = await context.getCurrentPageInfo();
      const actStartDetails_search = {
        actionName: actionName,
        actionArgs: input,
        currentPage: {
          title: currentPageInfo.title,
          url: currentPageInfo.url,
          tabId: currentPageInfo.tabId,
        },
      };

      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, actStartDetails_search);

      const searchURL = `https://www.google.com/search?q=${input.query}`;
      await context.browserContext.navigateTo(searchURL);

      const msg2 = `Searched for "${input.query}" in Google`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Action ${actionName} successful`, undefined, {
        result: msg2,
        currentPage: actStartDetails_search.currentPage,
      });
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
        sourceURL: searchURL,
      });
    }, searchGoogleActionSchema);
    actions.push(searchGoogle);

    const goToUrl = new Action(async (input: z.infer<typeof goToUrlActionSchema.schema>) => {
      const actionName = goToUrlActionSchema.name;
      const baseDetail = `Navigating to ${input.url}`;
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;

      // Get current page info for action event
      const currentPageInfo = await this.context.getCurrentPageInfo();
      const actStartDetails = {
        actionName: actionName,
        actionArgs: input,
        currentPage: {
          title: currentPageInfo.title,
          url: currentPageInfo.url,
          tabId: currentPageInfo.tabId,
        },
      };

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, actStartDetails);

      await this.context.browserContext.navigateTo(input.url);
      const msg2 = `Navigated to ${input.url}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Action ${actionName} successful`, undefined, {
        result: msg2,
        currentPage: actStartDetails.currentPage,
      });
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
        sourceURL: input.url,
      });
    }, goToUrlActionSchema);
    actions.push(goToUrl);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const goBack = new Action(async (input: z.infer<typeof goBackActionSchema.schema>) => {
      const actionName = goBackActionSchema.name;
      const baseDetail = 'Navigating back';
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, {
        actionName: actionName,
        actionArgs: input,
      });

      const page = await this.context.browserContext.getCurrentPage();
      await page.goBack();
      const msg2 = 'Navigated back';
      this.context.emitEvent(
        Actors.NAVIGATOR,
        ExecutionState.ACT_OK,
        `Action ${actionName} successful`,
        undefined,
        msg2,
      );
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    }, goBackActionSchema);
    actions.push(goBack);

    const refreshPage = new Action(async (input: z.infer<typeof refreshPageActionSchema.schema>) => {
      const actionName = refreshPageActionSchema.name;
      const baseDetail = 'Refreshing current page';
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;

      // Get current page info for action event
      const currentPageInfo = await this.context.getCurrentPageInfo();
      const actStartDetails = {
        actionName: actionName,
        actionArgs: input,
        currentPage: {
          title: currentPageInfo.title,
          url: currentPageInfo.url,
          tabId: currentPageInfo.tabId,
        },
      };

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, actStartDetails);

      const page = await this.context.browserContext.getCurrentPage();
      await page.refreshPage();
      const msg = 'Page refreshed successfully - useful for recovering from errors or loading issues';
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Action ${actionName} successful`, undefined, {
        result: msg,
        currentPage: actStartDetails.currentPage,
      });
      return new ActionResult({
        extractedContent: msg,
        includeInMemory: true,
      });
    }, refreshPageActionSchema);
    actions.push(refreshPage);

    const wait = new Action(async (input: z.infer<typeof waitActionSchema.schema>) => {
      const seconds = input.seconds || 3;
      const actionName = waitActionSchema.name;
      const baseDetail = `Waiting for ${seconds} seconds`;
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, {
        actionName: actionName,
        actionArgs: input,
      });
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      const msg = `${seconds} seconds elapsed`;
      this.context.emitEvent(
        Actors.NAVIGATOR,
        ExecutionState.ACT_OK,
        `Action ${actionName} successful`,
        undefined,
        msg,
      );
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, waitActionSchema);
    actions.push(wait);

    // Element Interaction Actions
    const clickElement = new Action(
      async (input: z.infer<typeof clickElementActionSchema.schema>) => {
        const actionName = clickElementActionSchema.name;
        const baseDetail = `Click element with index ${input.index}`;
        const finalDetail = `${actionName}: ${input.intent || baseDetail}`;

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          throw new Error(`Element with index ${input.index} does not exist - retry or use alternative actions`);
        }

        // Gather comprehensive element details for enhanced logging
        const elementDetails = {
          index: input.index,
          tagName: elementNode.tagName || 'unknown',
          text: elementNode.getAllTextTillNextClickableElement(2).trim(),
          xpath: elementNode.xpath || '',
          attributes: elementNode.attributes || {},
          isVisible: elementNode.isVisible,
          isInteractive: elementNode.isInteractive,
          isInViewport: elementNode.isInViewport,
        };

        // Extract specific attribute details
        const href = elementNode.attributes?.href;
        const title = elementNode.attributes?.title;
        const alt = elementNode.attributes?.alt;
        const className = elementNode.attributes?.class;
        const id = elementNode.attributes?.id;
        const role = elementNode.attributes?.role;
        const type = elementNode.attributes?.type;

        // Build detailed description
        const detailParts = [];
        if (elementDetails.tagName) detailParts.push(`Tag: ${elementDetails.tagName.toUpperCase()}`);
        if (elementDetails.text) detailParts.push(`Text: "${elementDetails.text}"`);
        if (href) detailParts.push(`Link: ${href}`);
        if (title) detailParts.push(`Title: "${title}"`);
        if (alt) detailParts.push(`Alt: "${alt}"`);
        if (type) detailParts.push(`Type: ${type}`);
        if (role) detailParts.push(`Role: ${role}`);
        if (className) detailParts.push(`Class: ${className}`);
        if (id) detailParts.push(`ID: ${id}`);

        const elementDescription = detailParts.join(' | ');

        const actStartDetails_click = {
          actionName: actionName,
          actionArgs: input,
          elementDetails: {
            ...elementDetails,
            description: elementDescription,
            href: href || null,
            title: title || null,
            alt: alt || null,
            className: className || null,
            id: id || null,
            role: role || null,
            type: type || null,
          },
          // Include Navigator context for better action reasoning
          navigatorContext: this.context.currentNavigatorContext,
          selectionReasoning: this.generateSelectionReasoning(elementNode, input, this.context.currentNavigatorContext),
        };

        this.context.emitEvent(
          Actors.NAVIGATOR,
          ExecutionState.ACT_START,
          finalDetail,
          undefined,
          actStartDetails_click,
        );

        // Check if element is a file uploader
        if (page.isFileUploader(elementNode)) {
          const msg = `Index ${input.index} - has an element which opens file upload dialog. To upload files please use a specific function to upload files. Element: ${elementDescription}`;
          logger.info(msg);
          return new ActionResult({
            extractedContent: msg,
            includeInMemory: true,
          });
        }

        try {
          const initialTabIds = await this.context.browserContext.getAllTabIds();
          await page.clickElementNode(this.context.options.useVision, elementNode);

          let msg = `Clicked element [${input.index}]: ${elementDescription}`;
          logger.info(msg);

          // TODO: could be optimized by chrome extension tab api
          const currentTabIds = await this.context.browserContext.getAllTabIds();
          if (currentTabIds.size > initialTabIds.size) {
            const newTabMsg = 'New tab opened - switching to it';
            msg += ` - ${newTabMsg}`;
            logger.info(newTabMsg);
            // find the tab id that is not in the initial tab ids
            const newTabId = Array.from(currentTabIds).find(id => !initialTabIds.has(id));
            if (newTabId) {
              // SECURITY FIX: Mark new tab as plugin-owned before switching
              // This tab was created by user action within plugin context
              if (!this.context.browserContext.isPluginOwnedTab(newTabId)) {
                // Add a method to adopt new tabs
                await this.context.browserContext.adoptTab(newTabId);
                logger.info(`Adopted new tab ${newTabId} as plugin-owned (created by click)`);
              }
              await this.context.browserContext.switchTab(newTabId);
            }
          }
          // Get URL after click and potential tab switch
          const finalPage = await this.context.browserContext.getCurrentPage();
          const finalURL = finalPage.url();

          // Pass comprehensive details as the output
          this.context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.ACT_OK,
            `Action ${actionName} successful`,
            undefined,
            {
              result: msg,
              elementDetails: actStartDetails_click.elementDetails,
              finalURL: finalURL,
            },
          );
          return new ActionResult({
            extractedContent: msg,
            includeInMemory: true,
            sourceURL: finalURL,
          });
        } catch (error) {
          const msg = `Element no longer available with index ${input.index} - most likely the page changed. Element was: ${elementDescription}`;
          this.context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.ACT_FAIL,
            `Action ${actionName} failed: ${msg}`,
            undefined,
            {
              error: msg,
              elementDetails: actStartDetails_click.elementDetails,
            },
          );
          return new ActionResult({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      clickElementActionSchema,
      true,
    );
    actions.push(clickElement);

    const inputText = new Action(
      async (input: z.infer<typeof inputTextActionSchema.schema>) => {
        const actionName = inputTextActionSchema.name;
        const baseDetail = `Input text into index ${input.index}`;
        const finalDetail = `${actionName}: ${input.intent || baseDetail}`;

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          throw new Error(`Element with index ${input.index} does not exist - retry or use alternative actions`);
        }

        // Gather comprehensive element details for enhanced logging
        const elementDetails = {
          index: input.index,
          tagName: elementNode.tagName || 'unknown',
          text: elementNode.getAllTextTillNextClickableElement(2).trim(),
          xpath: elementNode.xpath || '',
          attributes: elementNode.attributes || {},
          isVisible: elementNode.isVisible,
          isInteractive: elementNode.isInteractive,
          isInViewport: elementNode.isInViewport,
        };

        // Extract specific attribute details
        const placeholder = elementNode.attributes?.placeholder;
        const name = elementNode.attributes?.name;
        const id = elementNode.attributes?.id;
        const className = elementNode.attributes?.class;
        const type = elementNode.attributes?.type;
        const value = elementNode.attributes?.value;

        // Build detailed description
        const detailParts = [];
        if (elementDetails.tagName) detailParts.push(`Tag: ${elementDetails.tagName.toUpperCase()}`);
        if (placeholder) detailParts.push(`Placeholder: "${placeholder}"`);
        if (name) detailParts.push(`Name: ${name}`);
        if (type) detailParts.push(`Type: ${type}`);
        if (value) detailParts.push(`Value: "${value}"`);
        if (className) detailParts.push(`Class: ${className}`);
        if (id) detailParts.push(`ID: ${id}`);
        if (elementDetails.text) detailParts.push(`Text: "${elementDetails.text}"`);

        const elementDescription = detailParts.join(' | ');

        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, {
          actionName: actionName,
          actionArgs: input,
          elementDetails: {
            ...elementDetails,
            description: elementDescription,
            placeholder: placeholder || null,
            name: name || null,
            id: id || null,
            className: className || null,
            type: type || null,
            value: value || null,
          },
        });

        await page.inputTextElementNode(this.context.options.useVision, elementNode, input.text);
        const msg = `Input "${input.text}" into element [${input.index}]: ${elementDescription}`;
        // Pass comprehensive details as the output
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Action ${actionName} successful`, undefined, {
          result: msg,
          elementDetails: {
            ...elementDetails,
            description: elementDescription,
            inputText: input.text,
          },
        });
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      },
      inputTextActionSchema,
      true,
    );
    actions.push(inputText);

    // Tab Management Actions
    const switchTab = new Action(async (input: z.infer<typeof switchTabActionSchema.schema>) => {
      const actionName = switchTabActionSchema.name;
      const baseDetail = `Switching to tab ${input.tab_id}`;
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, {
        actionName: actionName,
        actionArgs: input,
      });
      await this.context.browserContext.switchTab(input.tab_id);
      const msg = `Switched to tab ${input.tab_id}`;
      // Pass msg as the output
      this.context.emitEvent(
        Actors.NAVIGATOR,
        ExecutionState.ACT_OK,
        `Action ${actionName} successful`,
        undefined,
        msg,
      );
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, switchTabActionSchema);
    actions.push(switchTab);

    const openTab = new Action(async (input: z.infer<typeof openTabActionSchema.schema>) => {
      const actionName = openTabActionSchema.name;
      const baseDetail = `Opening ${input.url} in new tab`;
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, {
        actionName: actionName,
        actionArgs: input,
      });
      await this.context.browserContext.openTab(input.url);
      const msg = `Opened ${input.url} in new tab`;
      // Pass msg as the output
      this.context.emitEvent(
        Actors.NAVIGATOR,
        ExecutionState.ACT_OK,
        `Action ${actionName} successful`,
        undefined,
        msg,
      );
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, openTabActionSchema);
    actions.push(openTab);

    const closeTab = new Action(async (input: z.infer<typeof closeTabActionSchema.schema>) => {
      const actionName = closeTabActionSchema.name;
      const baseDetail = `Closing tab ${input.tab_id}`;
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, {
        actionName: actionName,
        actionArgs: input,
      });
      await this.context.browserContext.closeTab(input.tab_id);
      const msg = `Closed tab ${input.tab_id}`;
      this.context.emitEvent(
        Actors.NAVIGATOR,
        ExecutionState.ACT_OK,
        `Action ${actionName} successful`,
        undefined,
        msg,
      );
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, closeTabActionSchema);
    actions.push(closeTab);

    // Content Actions
    // TODO: this is not used currently, need to improve on input size
    // const extractContent = new Action(async (input: z.infer<typeof extractContentActionSchema.schema>) => {
    //   const goal = input.goal;
    //   const intent = input.intent || `Extracting content from page`;
    //   this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    //   const page = await this.context.browserContext.getCurrentPage();
    //   const content = await page.getReadabilityContent();
    //   const promptTemplate = PromptTemplate.fromTemplate(
    //     'Your task is to extract the content of the page. You will be given a page and a goal and you should extract all relevant information around this goal from the page. If the goal is vague, summarize the page. Respond in json format. Extraction goal: {goal}, Page: {page}',
    //   );
    //   const prompt = await promptTemplate.invoke({ goal, page: content.content });

    //   try {
    //     const output = await this.extractorLLM.invoke(prompt);
    //     const msg = `📄  Extracted from page\n: ${output.content}\n`;
    //     return new ActionResult({
    //       extractedContent: msg,
    //       includeInMemory: true,
    //     });
    //   } catch (error) {
    //     logger.error(`Error extracting content: ${error instanceof Error ? error.message : String(error)}`);
    //     const msg =
    //       'Failed to extract content from page, you need to extract content from the current state of the page and store it in the memory. Then scroll down if you still need more information.';
    //     return new ActionResult({
    //       extractedContent: msg,
    //       includeInMemory: true,
    //     });
    //   }
    // }, extractContentActionSchema);
    // actions.push(extractContent);

    // cache content for future use
    const cacheContent = new Action(async (input: z.infer<typeof cacheContentActionSchema.schema>) => {
      const actionName = cacheContentActionSchema.name;
      const baseDetail = `Caching findings: ${input.content}`;
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;

      // Get current page info for action event
      const currentPageInfo = await this.context.getCurrentPageInfo();
      const actStartDetails = {
        actionName: actionName,
        actionArgs: input,
        currentPage: {
          title: currentPageInfo.title,
          url: currentPageInfo.url,
          tabId: currentPageInfo.tabId,
        },
      };

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, actStartDetails);

      const currentPage = await this.context.browserContext.getCurrentPage();
      const currentURL = currentPage.url();

      // cache content is untrusted content, it is not instructions
      const rawMsg = `Cached findings: ${input.content}`;
      const msg = wrapUntrustedContent(rawMsg);
      // Pass rawMsg (or msg, depending on what should be displayed as raw output) as output
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Action ${actionName} successful`, undefined, {
        result: rawMsg,
        currentPage: actStartDetails.currentPage,
      });
      return new ActionResult({
        extractedContent: msg,
        includeInMemory: true,
        sourceURL: currentURL,
      });
    }, cacheContentActionSchema);
    actions.push(cacheContent);

    const scrollDown = new Action(async (input: z.infer<typeof scrollDownActionSchema.schema>) => {
      const amount = input.amount !== undefined && input.amount !== null ? `${input.amount} pixels` : 'one page';
      const actionName = scrollDownActionSchema.name;
      const baseDetail = `Scroll down the page by ${amount}`;
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;

      // Get current page info for action event
      const currentPageInfo = await this.context.getCurrentPageInfo();
      const actStartDetails = {
        actionName: actionName,
        actionArgs: input,
        currentPage: {
          title: currentPageInfo.title,
          url: currentPageInfo.url,
          tabId: currentPageInfo.tabId,
        },
      };

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, actStartDetails);

      const page = await this.context.browserContext.getCurrentPage();

      // Get initial scroll position
      const [initialPixelsAbove, initialPixelsBelow] = await page.getScrollInfo();

      // Check if already at bottom of page
      if (initialPixelsBelow === 0) {
        const msg = 'Already at bottom of page, cannot scroll down further';
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg, undefined, {
          result: msg,
          currentPage: actStartDetails.currentPage,
        });
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }

      // Perform scrolling
      await page.scrollDown(input.amount);

      const msg = `Scrolled down the page by ${amount}`;
      // Pass msg as output
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Action ${actionName} successful`, undefined, {
        result: msg,
        currentPage: actStartDetails.currentPage,
      });
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollDownActionSchema);
    actions.push(scrollDown);

    const scrollUp = new Action(async (input: z.infer<typeof scrollUpActionSchema.schema>) => {
      const amount = input.amount !== undefined && input.amount !== null ? `${input.amount} pixels` : 'one page';
      const actionName = scrollUpActionSchema.name;
      const baseDetail = `Scroll up the page by ${amount}`;
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;

      // Get current page info for action event
      const currentPageInfo = await this.context.getCurrentPageInfo();
      const actStartDetails = {
        actionName: actionName,
        actionArgs: input,
        currentPage: {
          title: currentPageInfo.title,
          url: currentPageInfo.url,
          tabId: currentPageInfo.tabId,
        },
      };

      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, actStartDetails);

      const page = await this.context.browserContext.getCurrentPage();

      // Get initial scroll position
      const [initialPixelsAbove] = await page.getScrollInfo();

      // Check if already at top of page
      if (initialPixelsAbove === 0) {
        const msg = 'Already at top of page, cannot scroll up further';
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg, undefined, {
          result: msg,
          currentPage: actStartDetails.currentPage,
        });
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }

      // Perform scrolling
      await page.scrollUp(input.amount);
      const msg = `Scrolled up the page by ${amount}`;
      // Pass msg as output
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Action ${actionName} successful`, undefined, {
        result: msg,
        currentPage: actStartDetails.currentPage,
      });
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollUpActionSchema);
    actions.push(scrollUp);

    // Keyboard Actions
    const sendKeys = new Action(async (input: z.infer<typeof sendKeysActionSchema.schema>) => {
      const actionName = sendKeysActionSchema.name;
      const baseDetail = `Send keys: ${input.keys}`;
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, {
        actionName: actionName,
        actionArgs: input,
      });

      const page = await this.context.browserContext.getCurrentPage();
      await page.sendKeys(input.keys);
      const msg = `Sent keys: ${input.keys}`;
      // Pass msg as output
      this.context.emitEvent(
        Actors.NAVIGATOR,
        ExecutionState.ACT_OK,
        `Action ${actionName} successful`,
        undefined,
        msg,
      );
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, sendKeysActionSchema);
    actions.push(sendKeys);

    const scrollToText = new Action(async (input: z.infer<typeof scrollToTextActionSchema.schema>) => {
      const actionName = scrollToTextActionSchema.name;
      const baseDetail = `Scroll to text: ${input.text}`;
      const finalDetail = `${actionName}: ${input.intent || baseDetail}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, {
        actionName: actionName,
        actionArgs: input,
      });

      const page = await this.context.browserContext.getCurrentPage();
      try {
        const scrolled = await page.scrollToText(input.text);
        const msg = scrolled
          ? `Scrolled to text: ${input.text}`
          : `Text '${input.text}' not found or not visible on page`;
        // Pass msg as output
        this.context.emitEvent(
          Actors.NAVIGATOR,
          ExecutionState.ACT_OK,
          `Action ${actionName} successful`,
          undefined,
          msg,
        );
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      } catch (error) {
        const msg = `Failed to scroll to text: ${error instanceof Error ? error.message : String(error)}`;
        this.context.emitEvent(
          Actors.NAVIGATOR,
          ExecutionState.ACT_FAIL,
          `Action ${actionName} failed: ${msg}`,
          undefined,
          msg,
        );
        return new ActionResult({ error: msg, includeInMemory: true });
      }
    }, scrollToTextActionSchema);
    actions.push(scrollToText);

    // Get all options from a native dropdown
    const getDropdownOptions = new Action(
      async (input: z.infer<typeof getDropdownOptionsActionSchema.schema>) => {
        const actionName = getDropdownOptionsActionSchema.name;
        const baseDetail = `Getting options from dropdown with index ${input.index}`;
        const finalDetail = `${actionName}: ${input.intent || baseDetail}`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, {
          actionName: actionName,
          actionArgs: input,
        });

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = `Element with index ${input.index} does not exist - retry or use alternative actions`;
          logger.error(errorMsg);
          this.context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.ACT_FAIL,
            `Action ${actionName} failed: ${errorMsg}`,
            undefined,
            errorMsg,
          );
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }

        try {
          // Use the existing getDropdownOptions method
          const options = await page.getDropdownOptions(input.index);

          if (options && options.length > 0) {
            // Format options for display
            const formattedOptions: string[] = options.map(opt => {
              // Encoding ensures AI uses the exact string in select_dropdown_option
              const encodedText = JSON.stringify(opt.text);
              return `${opt.index}: text=${encodedText}`;
            });

            let msg = formattedOptions.join('\n');
            msg += '\nUse the exact text string in select_dropdown_option';
            logger.info(msg);
            // Pass msg (formatted options) as output
            this.context.emitEvent(
              Actors.NAVIGATOR,
              ExecutionState.ACT_OK,
              `Action ${actionName} successful: Got ${options.length} options from dropdown`,
              undefined,
              msg,
            );
            return new ActionResult({
              extractedContent: msg,
              includeInMemory: true,
            });
          }

          // This code should not be reached as getDropdownOptions throws an error when no options found
          // But keeping as fallback
          const msg = 'No options found in dropdown';
          logger.info(msg);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg, undefined, msg);
          return new ActionResult({
            extractedContent: msg,
            includeInMemory: true,
          });
        } catch (error) {
          const errorMsg = `Failed to get dropdown options: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          this.context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.ACT_FAIL,
            `Action ${actionName} failed: ${errorMsg}`,
            undefined,
            errorMsg,
          );
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }
      },
      getDropdownOptionsActionSchema,
      true,
    );
    actions.push(getDropdownOptions);

    // Select dropdown option for interactive element index by the text of the option you want to select'
    const selectDropdownOption = new Action(
      async (input: z.infer<typeof selectDropdownOptionActionSchema.schema>) => {
        const actionName = selectDropdownOptionActionSchema.name;
        const baseDetail = `Select option "${input.text}" from dropdown with index ${input.index}`;
        const finalDetail = `${actionName}: ${input.intent || baseDetail}`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, finalDetail, undefined, {
          actionName: actionName,
          actionArgs: input,
        });

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = `Element with index ${input.index} does not exist - retry or use alternative actions`;
          logger.error(errorMsg);
          this.context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.ACT_FAIL,
            `Action ${actionName} failed: ${errorMsg}`,
            undefined,
            errorMsg,
          );
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }

        // Reverted to original check for select element
        if (!elementNode.tagName || elementNode.tagName.toLowerCase() !== 'select') {
          const errorMsg = `Cannot select option: Element with index ${input.index} is a ${elementNode.tagName || 'unknown'}, not a SELECT`;
          logger.error(errorMsg);
          this.context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.ACT_FAIL,
            `Action ${actionName} failed: ${errorMsg}`,
            undefined,
            errorMsg,
          );
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }

        logger.debug(`Attempting to select '${input.text}' for element index ${input.index}`);

        try {
          await page.selectDropdownOption(input.index, input.text);
          const msg = `Selected option "${input.text}" from dropdown with index ${input.index}`;
          logger.info(msg);
          this.context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.ACT_OK,
            `Action ${actionName} successful`,
            undefined,
            msg,
          );
          return new ActionResult({
            extractedContent: msg,
            includeInMemory: true,
          });
        } catch (error) {
          const errorMsg = `Failed to select option: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          this.context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.ACT_FAIL,
            `Action ${actionName} failed: ${errorMsg}`,
            undefined,
            errorMsg,
          );
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }
      },
      selectDropdownOptionActionSchema,
      true,
    );
    actions.push(selectDropdownOption);

    return actions;
  }
}
