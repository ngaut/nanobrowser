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
    // Handle special case for about:blank
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

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Instead of checking for content scripts, directly inject buildDomTree function
        await this.injectBuildDomTreeFunction(tabId);

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: args => {
            // Access buildDomTree from the window context of the target page
            return window.buildDomTree(args);
          },
          args: [
            {
              showHighlightElements,
              focusHighlightIndex: focusElement,
              viewportExpansion,
              debugMode,
            } as BuildDomTreeArgs,
          ],
        });

        // Add comprehensive safety checks for script execution results
        if (!results || !Array.isArray(results) || results.length === 0) {
          throw new BrowserError('Failed to build DOM tree: No results from script execution');
        }

        const result = results[0];
        if (!result || typeof result !== 'object' || !('result' in result)) {
          throw new BrowserError('Failed to build DOM tree: Invalid result structure from script execution');
        }

        const evalPage = result.result as unknown as BuildDomTreeResult;
        if (!evalPage || typeof evalPage !== 'object') {
          throw new BrowserError('Failed to build DOM tree: evalPage is not an object');
        }

        if (!evalPage.map || typeof evalPage.map !== 'object' || Array.isArray(evalPage.map)) {
          throw new BrowserError('Failed to build DOM tree: evalPage.map is not a valid object');
        }

        if (!evalPage.rootId || typeof evalPage.rootId !== 'string') {
          throw new BrowserError('Failed to build DOM tree: evalPage.rootId is not a valid string');
        }

        // Log performance metrics in debug mode
        if (debugMode && evalPage.perfMetrics) {
          logger.debug('DOM Tree Building Performance Metrics', { metrics: evalPage.perfMetrics });
        }

        logger.debug('DOM tree built successfully', {
          attempt,
          tabId,
          url,
          nodeCount: evalPage.map && typeof evalPage.map === 'object' ? Object.keys(evalPage.map).length : 0,
        });

        return this.constructDomTree(evalPage);
      } catch (error) {
        lastError = error as Error;
        logger.warn(`DOM tree build attempt ${attempt}/${maxRetries} failed`, {
          error: lastError.message,
          tabId,
          url,
        });

        if (attempt < maxRetries) {
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    // If we get here, all retries failed
    logger.error('All DOM tree build attempts failed', lastError || new Error('Unknown error'), {
      tabId,
      url,
    });
    throw lastError || new Error('Failed to build DOM tree after multiple attempts');
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
    const jsNodeMap = evalPage.map;
    const jsRootId = evalPage.rootId;

    // Validate jsNodeMap before iteration
    if (!jsNodeMap || typeof jsNodeMap !== 'object' || Array.isArray(jsNodeMap)) {
      const errorMessage = `Invalid jsNodeMap structure: type=${typeof jsNodeMap}, isArray=${Array.isArray(jsNodeMap)}`;
      logger.error('Invalid jsNodeMap structure', new ValidationError(errorMessage), {
        jsNodeMap: jsNodeMap,
      });
      throw new ValidationError('Failed to build DOM tree: Invalid node map structure');
    }

    const selectorMap = new Map<number, DOMElementNode>();
    const nodeMap: Record<string, DOMBaseNode> = {};

    // First pass: create all nodes - add safety check for Object.entries
    try {
      const entries = Object.entries(jsNodeMap);
      if (!Array.isArray(entries)) {
        throw new ValidationError('Object.entries did not return an array');
      }

      for (const [id, nodeData] of entries) {
        if (!nodeData || typeof nodeData !== 'object') {
          logger.warn('Skipping invalid node data', { id, nodeDataType: typeof nodeData });
          continue;
        }

        const [node] = this.parseNode(nodeData);
        if (node === null) {
          continue;
        }

        nodeMap[id] = node;

        // Add to selector map if it has a highlight index
        if (node instanceof DOMElementNode && node.highlightIndex !== undefined && node.highlightIndex !== null) {
          selectorMap.set(node.highlightIndex, node);
        }
      }
    } catch (error) {
      logger.error('Failed to iterate over jsNodeMap', error as Error, {
        jsNodeMapKeys: jsNodeMap && typeof jsNodeMap === 'object' ? Object.keys(jsNodeMap).length : 'N/A',
      });
      throw new ValidationError(
        `Failed to build DOM tree: Error during node iteration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Second pass: build the tree structure - add safety check for Object.entries
    try {
      const nodeEntries = Object.entries(nodeMap);
      if (!Array.isArray(nodeEntries)) {
        throw new ValidationError('Object.entries for nodeMap did not return an array');
      }

      for (const [id, node] of nodeEntries) {
        if (node instanceof DOMElementNode) {
          const nodeData = jsNodeMap[id];
          if (!nodeData || typeof nodeData !== 'object') {
            logger.warn('Skipping node with invalid data in second pass', { id });
            continue;
          }

          const childrenIds = 'children' in nodeData ? nodeData.children : [];

          // Ensure childrenIds is always an array before iteration
          if (!Array.isArray(childrenIds)) {
            logger.warn('Invalid children data structure, expected array', {
              nodeId: id,
              tagName: node.tagName,
              childrenType: typeof childrenIds,
              childrenValue: childrenIds,
            });
            continue;
          }

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
    } catch (error) {
      logger.error('Failed to build tree structure in second pass', error as Error);
      throw new ValidationError(
        `Failed to build DOM tree: Error during tree construction: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const rootNode = nodeMap[jsRootId];

    if (rootNode === undefined || !(rootNode instanceof DOMElementNode)) {
      throw new ValidationError('Failed to build DOM tree: Root node not found or invalid');
    }

    logger.debug('DOM tree constructed successfully', {
      totalNodes: Object.keys(nodeMap).length,
      selectableElements: selectorMap.size,
      rootTag: rootNode.tagName,
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
