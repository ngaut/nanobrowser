import { HumanMessage, type SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { wrapUntrustedContent } from '../messages/utils';

/**
 * Abstract base class for all prompt types
 */
abstract class BasePrompt {
  /**
   * Returns the system message that defines the AI's role and behavior
   * @returns SystemMessage from LangChain
   */
  abstract getSystemMessage(): SystemMessage;

  /**
   * Returns the user message for the specific prompt type
   * @param context - Optional context data needed for generating the user message
   * @returns HumanMessage from LangChain
   */
  abstract getUserMessage(context: AgentContext): Promise<HumanMessage>;

  /**
   * Builds the user message containing the browser state
   * @param context - The agent context
   * @returns HumanMessage from LangChain
   */
  async buildBrowserStateUserMessage(context: AgentContext): Promise<HumanMessage> {
    // Use the same caching behavior as Navigator, but respect vision settings
    // useVision from context options, cacheClickableElementsHashes=true for consistency
    const browserState = await context.browserContext.getState(context.options.useVision, true);
    const rawElementsText = browserState.elementTree.clickableElementsToString(context.options.includeAttributes);
    const hasContentAbove = (browserState.pixelsAbove || 0) > 0;
    const hasContentBelow = (browserState.pixelsBelow || 0) > 0;

    let formattedElementsText = '';
    if (rawElementsText !== '') {
      const elementsText = wrapUntrustedContent(rawElementsText);

      if (hasContentAbove) {
        // formattedElementsText = `... ${browserState.pixelsAbove} pixels above - scroll up or extract content to see more ...\n${elementsText}`;
        formattedElementsText = `... ${browserState.pixelsAbove} pixels above - scroll up to see more ...\n${elementsText}`;
      } else {
        formattedElementsText = `[Start of page]\n${elementsText}`;
      }

      if (hasContentBelow) {
        // formattedElementsText = `${formattedElementsText}\n... ${browserState.pixelsBelow} pixels below - scroll down or extract content to see more ...`;
        formattedElementsText = `${formattedElementsText}\n... ${browserState.pixelsBelow} pixels below - scroll down to see more ...`;
      } else {
        formattedElementsText = `${formattedElementsText}\n[End of page]\n`;
      }
    } else {
      formattedElementsText = 'empty page';
    }

    let stepInfoDescription = '';
    if (context.stepInfo) {
      stepInfoDescription = `Current step: ${context.stepInfo.stepNumber + 1}/${context.stepInfo.maxSteps}`;
    }

    const timeStr = new Date().toISOString().slice(0, 16).replace('T', ' '); // Format: YYYY-MM-DD HH:mm
    stepInfoDescription += `Current date and time: ${timeStr}`;

    let actionResultsDescription = '';
    if (context.actionResults.length > 0) {
      for (let i = 0; i < context.actionResults.length; i++) {
        const result = context.actionResults[i];
        if (result.extractedContent) {
          let sourceText = '';
          if (result.sourceURL) {
            sourceText = ` (from ${result.sourceURL})`;
          }
          actionResultsDescription += `\nAction result ${i + 1}/${context.actionResults.length}${sourceText}: ${result.extractedContent}`;
        }
        if (result.error) {
          // only use last line of error
          const error = result.error.split('\n').pop();
          actionResultsDescription += `\nAction error ${i + 1}/${context.actionResults.length}: ...${error}`;
        }
      }
    }

    const currentTab = `{id: ${browserState.tabId}, url: ${browserState.url}, title: ${browserState.title}}`;

    // SECURITY FIX: Only show plugin-owned tabs, not user tabs
    const pluginOwnedTabs = browserState.tabs
      .filter(tab => tab.id !== browserState.tabId) // Exclude current tab
      .filter(tab => context.browserContext.isPluginOwnedTab(tab.id)) // Only plugin-owned tabs
      .map(tab => `- {id: ${tab.id}, url: ${tab.url}, title: ${tab.title}}`);

    let tabsSection = '';
    if (pluginOwnedTabs.length > 0) {
      tabsSection = `Other plugin-created tabs (you can switch to these):
  ${pluginOwnedTabs.join('\n')}`;
    } else {
      tabsSection = 'No other plugin-created tabs available. You can create new tabs if needed with open_tab action.';
    }

    // Detect common error scenarios based on page state (avoid hardcoded patterns)
    let errorContext = '';
    if (browserState.elementTree.clickableElementsToString().length === 0) {
      // Check if this is an expected empty page (new tab, about:blank, etc.)
      const isExpectedEmptyPage =
        browserState.url?.includes('chrome://newtab') ||
        browserState.url?.includes('about:blank') ||
        browserState.url === '' ||
        browserState.title?.includes('New Tab');

      if (isExpectedEmptyPage) {
        errorContext = `
📋 STARTING PAGE: Currently on a new tab or starting page. Navigate directly to relevant content for your task instead of trying to refresh or fix this page.`;
      } else if ((browserState.pixelsBelow || 0) === 0 && (browserState.pixelsAbove || 0) === 0) {
        errorContext = `
⚠️ POTENTIAL ISSUE: Content page appears empty - no interactive elements and no scrollable content. This could indicate a loading issue, error page, or content that requires different navigation approach.`;
      } else {
        errorContext = `
⚠️ LIMITED INTERACTION: No interactive elements detected in current viewport. Content may be available through scrolling, page loading may be incomplete, or this could be an error/restricted page.`;
      }
    }

    const stateDescription = `
[Task history memory ends]
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
Current tab: ${currentTab}
${tabsSection}${errorContext}
Interactive elements from top layer of the current page inside the viewport:
${formattedElementsText}
${stepInfoDescription}
${actionResultsDescription}
`;

    if (browserState.screenshot && context.options.useVision) {
      return new HumanMessage({
        content: [
          { type: 'text', text: stateDescription },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${browserState.screenshot}` },
          },
        ],
      });
    }

    return new HumanMessage(stateDescription);
  }
}

export { BasePrompt };
