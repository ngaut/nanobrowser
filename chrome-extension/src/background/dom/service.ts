import { createLogger } from '@src/background/log';
import type { BuildDomTreeArgs, RawDomTreeNode, BuildDomTreeResult } from './raw_types';
import { type DOMState, type DOMBaseNode, DOMElementNode, DOMTextNode } from './views';
import type { ViewportInfo } from './history/view';

const logger = createLogger('DOMService');

// Operation synchronization to prevent race conditions
const tabOperations = new Map<number, Promise<any>>();

/**
 * Serialize operations on a tab to prevent race conditions
 */
async function withTabLock<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
  // Wait for any existing operation on this tab to complete
  const existingOperation = tabOperations.get(tabId);
  if (existingOperation) {
    try {
      await existingOperation;
    } catch (error) {
      // Ignore errors from previous operations
      logger.debug(`Previous operation on tab ${tabId} failed:`, error);
    }
  }

  // Create new operation promise
  const currentOperation = operation();
  tabOperations.set(tabId, currentOperation);

  try {
    const result = await currentOperation;
    return result;
  } finally {
    // Clean up completed operation
    if (tabOperations.get(tabId) === currentOperation) {
      tabOperations.delete(tabId);
    }
  }
}

export interface ReadabilityResult {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string;
  dir: string;
  siteName: string;
  lang: string;
  publishedTime: string;
}

declare global {
  interface Window {
    buildDomTree: (args: BuildDomTreeArgs) => RawDomTreeNode | null;
    turn2Markdown: (selector?: string) => string;
    parserReadability: () => ReadabilityResult | null;
  }
}

/**
 * Get the markdown content for the current page.
 * @param tabId - The ID of the tab to get the markdown content for.
 * @param selector - The selector to get the markdown content for. If not provided, the body of the entire page will be converted to markdown.
 * @returns The markdown content for the selected element on the current page.
 */
export async function getMarkdownContent(tabId: number, selector?: string): Promise<string> {
  try {
    // Validate tab exists before attempting script execution
    try {
      await chrome.tabs.get(tabId);
    } catch (error) {
      throw new Error(`Tab ${tabId} is no longer valid: ${error instanceof Error ? error.message : String(error)}`);
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel?: string) => {
        return window.turn2Markdown(sel);
      },
      args: [selector],
    });
    const result = results[0]?.result;
    if (!result) {
      throw new Error('Failed to get markdown content');
    }
    return result as string;
  } catch (error) {
    logger.error('Failed to get markdown content:', error);
    throw error;
  }
}

/**
 * Get the readability content for the current page.
 * @param tabId - The ID of the tab to get the readability content for.
 * @returns The readability content for the current page.
 */
export async function getReadabilityContent(tabId: number): Promise<ReadabilityResult> {
  try {
    // Validate tab exists before attempting script execution
    try {
      await chrome.tabs.get(tabId);
    } catch (error) {
      throw new Error(`Tab ${tabId} is no longer valid: ${error instanceof Error ? error.message : String(error)}`);
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return window.parserReadability();
      },
    });
    const result = results[0]?.result;
    if (!result) {
      throw new Error('Failed to get readability content');
    }
    return result as ReadabilityResult;
  } catch (error) {
    logger.error('Failed to get readability content:', error);
    throw error;
  }
}

/**
 * Get the clickable elements for the current page.
 * @param tabId - The ID of the tab to get the clickable elements for.
 * @param url - The URL of the page.
 * @param showHighlightElements - Whether to show the highlight elements.
 * @param focusElement - The element to focus on.
 * @param viewportExpansion - The viewport expansion to use.
 * @returns A DOMState object containing the clickable elements for the current page.
 */
export async function getClickableElements(
  tabId: number,
  url: string,
  showHighlightElements = true,
  focusElement = -1,
  viewportExpansion = 0,
  debugMode = false,
): Promise<DOMState> {
  const [elementTree, selectorMap] = await _buildDomTree(
    tabId,
    url,
    showHighlightElements,
    focusElement,
    viewportExpansion,
    debugMode,
  );
  return { elementTree, selectorMap };
}

async function _buildDomTree(
  tabId: number,
  url: string,
  showHighlightElements = true,
  focusElement = -1,
  viewportExpansion = 0,
  debugMode = false,
): Promise<[DOMElementNode, Map<number, DOMElementNode>]> {
  return withTabLock(tabId, async () => {
    // If URL is provided and it's about:blank, return a minimal DOM tree
    if (url === 'about:blank') {
      const elementTree = new DOMElementNode({
        tagName: 'body',
        xpath: '',
        attributes: {},
        children: [],
        isVisible: false,
        isInteractive: false,
        isTopElement: false,
        isInViewport: false,
        parent: null,
      });
      return [elementTree, new Map<number, DOMElementNode>()];
    }

    try {
      // Validate tab exists before attempting script execution
      try {
        await chrome.tabs.get(tabId);
      } catch (error) {
        throw new Error(`Tab ${tabId} is no longer valid: ${error instanceof Error ? error.message : String(error)}`);
      }

      // First, check if the buildDomTree script is available
      const checkResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          return {
            hasBuildDomTree: typeof window.buildDomTree === 'function',
            documentReady: document.readyState,
            bodyExists: !!document.body,
            error: null,
          };
        },
      });

      const checkResult = checkResults[0]?.result;
      logger.debug('Script availability check:', checkResult);

      if (!checkResult?.hasBuildDomTree) {
        throw new Error('buildDomTree script not available on page. Script injection may have failed.');
      }

      if (!checkResult?.bodyExists) {
        throw new Error('Document body not available. Page may not have loaded properly.');
      }

      // Now execute the actual buildDomTree function
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: args => {
          try {
            // Access buildDomTree from the window context of the target page
            const result = window.buildDomTree(args);
            return {
              success: true,
              result: result,
              error: null,
            };
          } catch (error) {
            const errorObj = error instanceof Error ? error : new Error(String(error));
            return {
              success: false,
              result: null,
              error: {
                message: errorObj.message,
                stack: errorObj.stack,
                name: errorObj.name,
              },
            };
          }
        },
        args: [
          {
            showHighlightElements,
            focusHighlightIndex: focusElement,
            viewportExpansion,
            debugMode,
          },
        ],
      });

      const executionResult = results[0]?.result;

      if (!executionResult) {
        throw new Error('No result from script execution');
      }

      if (!executionResult.success) {
        const errorInfo = executionResult.error;
        logger.error('buildDomTree execution failed:', errorInfo);
        throw new Error(`buildDomTree execution failed: ${errorInfo?.message || 'Unknown error'}`);
      }

      const evalPage = executionResult.result as unknown as BuildDomTreeResult;

      if (!evalPage || !evalPage.map || !evalPage.rootId) {
        logger.error('Invalid buildDomTree result structure:', {
          hasEvalPage: !!evalPage,
          hasMap: !!evalPage?.map,
          hasRootId: !!evalPage?.rootId,
          mapKeys: evalPage?.map ? Object.keys(evalPage.map).length : 0,
          rootId: evalPage?.rootId,
        });
        throw new Error('Failed to build DOM tree: No result returned or invalid structure');
      }

      // Log performance metrics in debug mode
      if (debugMode && evalPage.perfMetrics) {
        logger.debug('DOM Tree Building Performance Metrics:', evalPage.perfMetrics);
      }

      return _constructDomTree(evalPage);
    } catch (error) {
      logger.error('_buildDomTree failed:', error);
      throw error;
    }
  });
}

/**
 * Constructs a DOM tree from the evaluated page data.
 * @param evalPage - The result of building the DOM tree.
 * @returns A tuple containing the DOM element tree and selector map.
 */
function _constructDomTree(evalPage: BuildDomTreeResult): [DOMElementNode, Map<number, DOMElementNode>] {
  const jsNodeMap = evalPage.map;
  const jsRootId = evalPage.rootId;

  const selectorMap = new Map<number, DOMElementNode>();
  const nodeMap: Record<string, DOMBaseNode> = {};

  // First pass: create all nodes
  for (const [id, nodeData] of Object.entries(jsNodeMap)) {
    const [node] = _parse_node(nodeData);
    if (node === null) {
      continue;
    }

    nodeMap[id] = node;

    // Add to selector map if it has a highlight index
    if (node instanceof DOMElementNode && node.highlightIndex !== undefined && node.highlightIndex !== null) {
      selectorMap.set(node.highlightIndex, node);
    }
  }

  // Second pass: build the tree structure
  for (const [id, node] of Object.entries(nodeMap)) {
    if (node instanceof DOMElementNode) {
      const nodeData = jsNodeMap[id];
      const childrenIds = 'children' in nodeData ? nodeData.children : [];

      for (const childId of childrenIds) {
        if (!(childId in nodeMap)) {
          continue;
        }

        const childNode = nodeMap[childId];

        childNode.parent = node;
        node.children.push(childNode);
      }
    }
  }

  const htmlToDict = nodeMap[jsRootId];

  if (htmlToDict === undefined || !(htmlToDict instanceof DOMElementNode)) {
    throw new Error('Failed to parse HTML to dictionary');
  }

  return [htmlToDict, selectorMap];
}

/**
 * Parse a raw DOM node and return the node object and its children IDs.
 * @param nodeData - The raw DOM node data to parse.
 * @returns A tuple containing the parsed node and an array of child IDs.
 */
export function _parse_node(nodeData: RawDomTreeNode): [DOMBaseNode | null, string[]] {
  if (!nodeData) {
    return [null, []];
  }

  // Process text nodes immediately
  if ('type' in nodeData && nodeData.type === 'TEXT_NODE') {
    const textNode = new DOMTextNode(nodeData.text, nodeData.isVisible, null);
    return [textNode, []];
  }

  // At this point, nodeData is RawDomElementNode (not a text node)
  // TypeScript needs help to narrow the type
  const elementData = nodeData as Exclude<RawDomTreeNode, { type: string }>;

  // Process viewport info if it exists
  let viewportInfo: ViewportInfo | undefined = undefined;
  if ('viewport' in nodeData && typeof nodeData.viewport === 'object' && nodeData.viewport) {
    const viewportObj = nodeData.viewport as { width: number; height: number };
    viewportInfo = {
      width: viewportObj.width,
      height: viewportObj.height,
      scrollX: 0,
      scrollY: 0,
    };
  }

  const elementNode = new DOMElementNode({
    tagName: elementData.tagName,
    xpath: elementData.xpath,
    attributes: elementData.attributes ?? {},
    children: [],
    isVisible: elementData.isVisible ?? false,
    isInteractive: elementData.isInteractive ?? false,
    isTopElement: elementData.isTopElement ?? false,
    isInViewport: elementData.isInViewport ?? false,
    highlightIndex: elementData.highlightIndex ?? null,
    shadowRoot: elementData.shadowRoot ?? false,
    parent: null,
    viewportInfo: viewportInfo,
  });

  const childrenIds = elementData.children || [];

  return [elementNode, childrenIds];
}

export async function removeHighlights(tabId: number): Promise<void> {
  try {
    // Validate tab exists before attempting script execution
    try {
      await chrome.tabs.get(tabId);
    } catch (error) {
      logger.warning(
        `Tab ${tabId} is no longer valid, skipping highlight removal: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Remove the highlight container and all its contents
        const container = document.getElementById('playwright-highlight-container');
        if (container) {
          container.remove();
        }

        // Remove highlight attributes from elements
        const highlightedElements = document.querySelectorAll('[browser-user-highlight-id^="playwright-highlight-"]');
        for (const el of Array.from(highlightedElements)) {
          el.removeAttribute('browser-user-highlight-id');
        }
      },
    });
  } catch (error) {
    logger.error('Failed to remove highlights:', error);
  }
}

/**
 * Get the scroll information for the current page.
 * @param tabId - The ID of the tab to get the scroll information for.
 * @returns A tuple containing the number of pixels above and below the current scroll position.
 */
export async function getScrollInfo(tabId: number): Promise<[number, number]> {
  try {
    // Validate tab exists before attempting script execution
    try {
      await chrome.tabs.get(tabId);
    } catch (error) {
      logger.warning(
        `Tab ${tabId} is no longer valid, returning default scroll info: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [0, 0];
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return [
          window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0,
          Math.max(
            0,
            (document.documentElement?.scrollHeight || document.body?.scrollHeight || 0) - window.innerHeight,
          ) - (window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0),
        ];
      },
    });
    const result = results[0]?.result as [number, number] | undefined;
    return result || [0, 0];
  } catch (error) {
    logger.error('Failed to get scroll info:', error);
    return [0, 0];
  }
}
