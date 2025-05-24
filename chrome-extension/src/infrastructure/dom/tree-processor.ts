import { createLogger } from '@src/infrastructure/monitoring/logger';
import { DOMState, DOMBaseNode, DOMElementNode, DOMTextNode } from './base-node';
import type { BuildDomTreeArgs, RawDomTreeNode, BuildDomTreeResult } from '@src/background/dom/raw_types';
import { DOMTextProcessor } from './text-processor';
import { BrowserError, ValidationError } from '@src/shared/types/errors';

const logger = createLogger('DOMTreeProcessor');

/**
 * DOM Tree processing service for building and manipulating DOM trees
 */
export class DOMTreeProcessor {
  /**
   * Get clickable elements for a tab by building the DOM tree
   */
  static async getClickableElements(
    tabId: number,
    url: string,
    showHighlightElements = true,
    focusElement = -1,
    viewportExpansion = 0,
    debugMode = false,
  ): Promise<DOMState> {
    const [elementTree, selectorMap] = await this.buildDomTree(
      tabId,
      url,
      showHighlightElements,
      focusElement,
      viewportExpansion,
      debugMode,
    );
    return { elementTree, selectorMap };
  }

  /**
   * Build DOM tree from a tab
   */
  private static async buildDomTree(
    tabId: number,
    url: string,
    showHighlightElements = true,
    focusElement = -1,
    viewportExpansion = 0,
    debugMode = false,
  ): Promise<[DOMElementNode, Map<number, DOMElementNode>]> {
    logger.debug('Building DOM tree', { tabId, url, debugMode });

    // Handle special case for about:blank
    if (url === 'about:blank') {
      logger.debug('Handling about:blank case');
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

    // Inject buildDomTree function if needed
    await this.injectBuildDomTreeFunction(tabId);

    const MAX_ATTEMPTS = 3;
    let attempt = 1;

    while (attempt <= MAX_ATTEMPTS) {
      try {
        logger.debug(`DOM tree build attempt ${attempt}/${MAX_ATTEMPTS}`, { tabId });

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (args: any) => {
            return window.buildDomTree(args);
          },
          args: [
            {
              showHighlightElements,
              focusElement,
              viewportExpansion,
              debugMode,
            },
          ],
        });

        const evalPage = results[0]?.result;

        if (!evalPage) {
          throw new BrowserError(`buildDomTree returned no results on attempt ${attempt}`);
        }

        logger.debug('DOM script execution completed successfully', {
          tabId,
          attempt,
          hasMap: !!evalPage.map,
          hasRootId: !!evalPage.rootId,
        });

        return this.constructDomTree(evalPage);
      } catch (error) {
        logger.warn(`DOM tree build attempt ${attempt} failed`, {
          error: (error as Error).message,
          tabId,
          attempt,
          maxAttempts: MAX_ATTEMPTS,
        });

        if (attempt === MAX_ATTEMPTS) {
          throw new BrowserError(
            `Failed to build DOM tree after ${MAX_ATTEMPTS} attempts: ${(error as Error).message}`,
          );
        }

        attempt++;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    throw new BrowserError('Unexpected error in buildDomTree - should not reach here');
  }

  /**
   * Inject the buildDomTree function into the target tab
   */
  private static async injectBuildDomTreeFunction(tabId: number): Promise<void> {
    try {
      // Check if buildDomTree is already available
      const checkResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => typeof window.buildDomTree === 'function',
      });

      if (checkResults[0]?.result === true) {
        logger.debug('buildDomTree function already available', { tabId });
        return;
      }

      // Inject the buildDomTree function by reading it from the dist file and executing it
      logger.debug('Injecting buildDomTree function', { tabId });

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['buildDomTree.js'],
      });

      // Verify injection worked
      const verifyResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          return {
            hasBuildDomTree: typeof window.buildDomTree === 'function',
            buildDomTreeType: typeof window.buildDomTree,
          };
        },
      });

      const verifyResult = verifyResults[0]?.result;
      if (!verifyResult?.hasBuildDomTree) {
        throw new BrowserError(`buildDomTree injection failed. Type: ${verifyResult?.buildDomTreeType}`);
      }

      logger.debug('buildDomTree function injected successfully', { tabId });
    } catch (error) {
      logger.error('Failed to inject buildDomTree function', error as Error, { tabId });
      throw new BrowserError(
        `Failed to inject buildDomTree function: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Construct DOM tree from evaluated page data
   */
  private static constructDomTree(evalPage: BuildDomTreeResult): [DOMElementNode, Map<number, DOMElementNode>] {
    logger.debug('Constructing DOM tree from evaluation results');

    const jsNodeMap = evalPage.map;
    const jsRootId = parseInt(evalPage.rootId.toString(), 10);

    // Validate jsNodeMap before iteration
    if (!jsNodeMap || typeof jsNodeMap !== 'object') {
      throw new BrowserError('Invalid jsNodeMap: expected object');
    }

    if (isNaN(jsRootId)) {
      throw new BrowserError('Invalid jsRootId: expected valid numeric root ID');
    }

    // Validate Object.entries return before iteration
    let jsNodeMapEntries;
    try {
      jsNodeMapEntries = Object.entries(jsNodeMap);
      if (!Array.isArray(jsNodeMapEntries)) {
        throw new BrowserError('Object.entries(jsNodeMap) did not return an array');
      }
    } catch (error) {
      throw new BrowserError(`Failed to get jsNodeMap entries: ${(error as Error).message}`);
    }

    const nodeMap = new Map<number, DOMElementNode>();
    const selectorMap = new Map<number, DOMElementNode>();

    // First pass: create all nodes
    logger.debug('Starting DOM tree first pass: creating nodes', { nodeCount: jsNodeMapEntries.length });

    for (const [nodeIdStr, nodeData] of jsNodeMapEntries) {
      try {
        const nodeId = parseInt(nodeIdStr, 10);
        const [domNode] = this.parseNode(nodeData);
        if (domNode && domNode instanceof DOMElementNode) {
          nodeMap.set(nodeId, domNode);

          // Add to selector map if it has a highlight index
          if (domNode.highlightIndex !== undefined && domNode.highlightIndex !== null) {
            selectorMap.set(domNode.highlightIndex, domNode);
          }
        }
      } catch (error) {
        logger.warn('Failed to parse node during first pass', { error: (error as Error).message });
        // Continue with other nodes
      }
    }

    // Second pass: build tree structure
    logger.debug('Starting DOM tree second pass: building relationships');

    // Validate Object.entries on nodeMap before iteration
    let nodeEntries;
    try {
      nodeEntries = Array.from(nodeMap.entries());
      if (!Array.isArray(nodeEntries)) {
        throw new BrowserError('nodeMap.entries() did not return an array');
      }
    } catch (error) {
      throw new BrowserError(`Failed to get nodeMap entries: ${(error as Error).message}`);
    }

    for (const [nodeId, node] of nodeEntries) {
      try {
        const jsNode = jsNodeMap[nodeId.toString()];
        if (!jsNode) continue;

        // Get children IDs safely
        const childrenIds = (jsNode as any).children || [];

        // Validate childrenIds is array before iteration
        if (!Array.isArray(childrenIds)) {
          logger.warn('Invalid children data structure, expected array');
          continue;
        }

        for (const childId of childrenIds) {
          const childNode = nodeMap.get(childId);
          if (childNode) {
            node.children.push(childNode);
            childNode.parent = node;
          }
        }
      } catch (error) {
        logger.warn('Failed to build relationships for node', { error: (error as Error).message });
        // Continue with other nodes
      }
    }

    const rootNode = nodeMap.get(jsRootId);
    if (!rootNode) {
      throw new BrowserError(`Root node not found: ${jsRootId}`);
    }

    logger.info('DOM tree constructed successfully', {
      totalNodes: nodeMap.size,
      rootNodeTag: rootNode.tagName,
      selectableElements: selectorMap.size,
    });

    return [rootNode, selectorMap];
  }

  /**
   * Parse a raw DOM tree node into our internal representation
   */
  static parseNode(nodeData: RawDomTreeNode): [DOMBaseNode | null, string[]] {
    const warningMessages: string[] = [];

    try {
      // Handle text nodes - check for 'type' property to distinguish
      if ('type' in nodeData && nodeData.type === 'TEXT_NODE') {
        if (!('text' in nodeData)) {
          warningMessages.push('Text node missing text property');
          return [null, warningMessages];
        }

        return [new DOMTextNode(nodeData.text, nodeData.isVisible ?? false), warningMessages];
      }

      // Handle element nodes - no 'type' property means it's an element
      if (!('type' in nodeData)) {
        if (!('tagName' in nodeData)) {
          warningMessages.push('Element node missing tagName property');
          return [null, warningMessages];
        }

        const element = new DOMElementNode({
          tagName: nodeData.tagName,
          xpath: nodeData.xpath || null,
          attributes: nodeData.attributes || {},
          children: [], // Will be populated in second pass
          isVisible: nodeData.isVisible ?? false,
          isInteractive: nodeData.isInteractive ?? false,
          isTopElement: nodeData.isTopElement ?? false,
          isInViewport: nodeData.isInViewport ?? false,
          shadowRoot: nodeData.shadowRoot ?? false,
          highlightIndex: nodeData.highlightIndex ?? null,
          viewportCoordinates: nodeData.viewportCoordinates,
          pageCoordinates: nodeData.pageCoordinates,
          viewportInfo: nodeData.viewportInfo,
          isNew: null, // Not provided in raw data
        });

        return [element, warningMessages];
      }

      warningMessages.push(`Unknown node type: ${(nodeData as any).type || 'undefined'}`);
      return [null, warningMessages];
    } catch (error) {
      logger.error('Error parsing DOM node', error as Error, { nodeData });
      warningMessages.push(`Error parsing node: ${error instanceof Error ? error.message : String(error)}`);
      return [null, warningMessages];
    }
  }

  /**
   * Convert DOM element tree to dictionary representation
   */
  static domElementNodeToDict(elementTree: DOMBaseNode): unknown {
    function nodeToDict(node: DOMBaseNode): unknown {
      if (node instanceof DOMTextNode) {
        return {
          type: 'text',
          text: node.text,
          isVisible: node.isVisible,
        };
      } else if (node instanceof DOMElementNode) {
        return {
          type: 'element',
          tagName: node.tagName,
          xpath: node.xpath,
          attributes: node.attributes,
          isVisible: node.isVisible,
          isInteractive: node.isInteractive,
          isTopElement: node.isTopElement,
          isInViewport: node.isInViewport,
          shadowRoot: node.shadowRoot,
          highlightIndex: node.highlightIndex,
          children: node.children.map(nodeToDict),
        };
      }
      return null;
    }

    return nodeToDict(elementTree);
  }

  /**
   * Calculate branch path hash set for a DOM state
   */
  static async calcBranchPathHashSet(state: DOMState): Promise<Set<string>> {
    const hashSet = new Set<string>();

    const processNode = async (node: DOMBaseNode): Promise<void> => {
      if (node instanceof DOMElementNode) {
        try {
          const hash = await node.hash();
          if (hash.branchPathHash) {
            hashSet.add(hash.branchPathHash);
          }
        } catch (error) {
          logger.warn('Failed to hash DOM element', {
            error: error instanceof Error ? error.message : String(error),
            tagName: node.tagName,
            highlightIndex: node.highlightIndex,
          });
        }

        // Process children
        for (const child of node.children) {
          await processNode(child);
        }
      }
    };

    await processNode(state.elementTree);
    return hashSet;
  }

  /**
   * Find elements by tag name
   */
  static findElementsByTag(root: DOMElementNode, tagName: string): DOMElementNode[] {
    const elements: DOMElementNode[] = [];

    const search = (node: DOMBaseNode): void => {
      if (node instanceof DOMElementNode) {
        if (node.tagName?.toLowerCase() === tagName.toLowerCase()) {
          elements.push(node);
        }
        for (const child of node.children) {
          search(child);
        }
      }
    };

    search(root);
    return elements;
  }

  /**
   * Find elements by attribute
   */
  static findElementsByAttribute(
    root: DOMElementNode,
    attributeName: string,
    attributeValue?: string,
  ): DOMElementNode[] {
    const elements: DOMElementNode[] = [];

    const search = (node: DOMBaseNode): void => {
      if (node instanceof DOMElementNode) {
        if (attributeName in node.attributes) {
          if (attributeValue === undefined || node.attributes[attributeName] === attributeValue) {
            elements.push(node);
          }
        }
        for (const child of node.children) {
          search(child);
        }
      }
    };

    search(root);
    return elements;
  }

  /**
   * Count elements in the tree
   */
  static countElements(root: DOMBaseNode): { elements: number; textNodes: number; total: number } {
    let elements = 0;
    let textNodes = 0;

    const count = (node: DOMBaseNode): void => {
      if (node instanceof DOMElementNode) {
        elements++;
        for (const child of node.children) {
          count(child);
        }
      } else if (node instanceof DOMTextNode) {
        textNodes++;
      }
    };

    count(root);
    return { elements, textNodes, total: elements + textNodes };
  }
}
