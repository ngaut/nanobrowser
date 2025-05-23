import { createLogger } from '@src/infrastructure/monitoring/logger';
import { DOMState } from './base-node';
import { DOMTreeProcessor } from './tree-processor';
import { DOMTextProcessor } from './text-processor';
import { DOMSelectorProcessor } from './selector-processor';
import { EnhancedDOMElement } from './enhanced-element';
import { DOMElementNode } from './base-node';
import { BrowserError } from '@src/shared/types/errors';

const logger = createLogger('DOMService');

/**
 * High-level DOM service interface for readability content
 */
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

/**
 * Global window interface for injected functions
 */
declare global {
  interface Window {
    buildDomTree: (args: any) => any;
    turn2Markdown: (selector?: string) => string;
    parserReadability: () => ReadabilityResult | null;
  }
}

/**
 * Modern DOM Service using infrastructure modules
 * Provides high-level DOM operations and utilities
 */
export class DOMService {
  /**
   * Get clickable elements for a tab
   */
  static async getClickableElements(
    tabId: number,
    url: string,
    showHighlightElements = true,
    focusElement = -1,
    viewportExpansion = 0,
    debugMode = false,
  ): Promise<DOMState> {
    try {
      const [elementTree, selectorMap] = await DOMTreeProcessor.getClickableElements(
        tabId,
        url,
        showHighlightElements,
        focusElement,
        viewportExpansion,
        debugMode,
      );

      if (!elementTree) {
        throw new BrowserError('Failed to get clickable elements: No element tree returned');
      }

      return { elementTree, selectorMap };
    } catch (error) {
      logger.error('Failed to get clickable elements', error as Error, { tabId, url });

      // Return a minimal valid DOM state instead of throwing
      const fallbackTree = new DOMElementNode({
        tagName: 'body',
        xpath: '',
        attributes: {},
        children: [],
        isVisible: true,
        isInteractive: false,
        isTopElement: true,
        isInViewport: true,
        parent: null,
      });

      // Add the missing method to prevent errors
      (fallbackTree as any).clickableElementsToString = (includeAttributes: string[] = []) => {
        return '<!-- Page content unavailable - DOM tree building failed -->';
      };

      return {
        elementTree: fallbackTree,
        selectorMap: new Map<number, DOMElementNode>(),
      };
    }
  }

  /**
   * Get markdown content for a page
   */
  static async getMarkdownContent(tabId: number, selector?: string): Promise<string> {
    logger.debug('Getting markdown content', { tabId, selector });

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: sel => {
          return window.turn2Markdown(sel);
        },
        args: [selector || ''],
      });

      const result = results[0]?.result;
      if (!result) {
        throw new BrowserError('Failed to get markdown content');
      }

      logger.info('Successfully retrieved markdown content', {
        tabId,
        contentLength: result.length,
        hasSelector: !!selector,
      });

      return result as string;
    } catch (error) {
      logger.error('Failed to get markdown content', error, { tabId, selector });
      throw error;
    }
  }

  /**
   * Get readability content for a page
   */
  static async getReadabilityContent(tabId: number): Promise<ReadabilityResult> {
    logger.debug('Getting readability content', { tabId });

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          return window.parserReadability();
        },
      });

      const result = results[0]?.result;
      if (!result) {
        throw new BrowserError('Failed to get readability content');
      }

      logger.info('Successfully retrieved readability content', {
        tabId,
        title: result.title,
        contentLength: result.content.length,
      });

      return result as ReadabilityResult;
    } catch (error) {
      logger.error('Failed to get readability content', error, { tabId });
      throw error;
    }
  }

  /**
   * Remove highlights from a page
   */
  static async removeHighlights(tabId: number): Promise<void> {
    logger.debug('Removing highlights', { tabId });

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Remove all highlight styles
          const highlighted = document.querySelectorAll('[data-highlight-index]');
          highlighted.forEach(el => {
            el.removeAttribute('data-highlight-index');
            (el as HTMLElement).style.removeProperty('outline');
            (el as HTMLElement).style.removeProperty('background-color');
          });
        },
      });

      logger.info('Successfully removed highlights', { tabId });
    } catch (error) {
      logger.error('Failed to remove highlights', error, { tabId });
      throw error;
    }
  }

  /**
   * Get scroll information for a page
   */
  static async getScrollInfo(tabId: number): Promise<[number, number]> {
    logger.debug('Getting scroll info', { tabId });

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
          const scrollHeight = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight,
          );
          return [scrollTop, scrollHeight];
        },
      });

      const result = results[0]?.result as [number, number];
      if (!result) {
        throw new BrowserError('Failed to get scroll info');
      }

      logger.debug('Successfully retrieved scroll info', {
        tabId,
        scrollTop: result[0],
        scrollHeight: result[1],
      });

      return result;
    } catch (error) {
      logger.error('Failed to get scroll info', error, { tabId });
      throw error;
    }
  }

  /**
   * Parse a raw DOM tree node using the tree processor
   */
  static parseNode(nodeData: any) {
    return DOMTreeProcessor.parseNode(nodeData);
  }

  /**
   * Convert DOM element tree to dictionary
   */
  static domElementNodeToDict(elementTree: any) {
    return DOMTreeProcessor.domElementNodeToDict(elementTree);
  }

  /**
   * Calculate branch path hash set for DOM state
   */
  static async calcBranchPathHashSet(state: DOMState): Promise<Set<string>> {
    return DOMTreeProcessor.calcBranchPathHashSet(state);
  }

  /**
   * Enhance a DOM state with additional functionality
   */
  static enhanceDOMState(state: DOMState): DOMState {
    const enhancedTree = EnhancedDOMElement.fromDOMElement(state.elementTree);

    return {
      elementTree: enhancedTree,
      selectorMap: state.selectorMap,
    };
  }

  /**
   * Find elements in DOM state by tag name
   */
  static findElementsByTag(state: DOMState, tagName: string) {
    return DOMTreeProcessor.findElementsByTag(state.elementTree, tagName);
  }

  /**
   * Find elements in DOM state by attribute
   */
  static findElementsByAttribute(state: DOMState, attributeName: string, attributeValue?: string) {
    return DOMTreeProcessor.findElementsByAttribute(state.elementTree, attributeName, attributeValue);
  }

  /**
   * Get statistics about a DOM state
   */
  static getDOMStatistics(state: DOMState) {
    const counts = DOMTreeProcessor.countElements(state.elementTree);
    const visibleText = DOMTextProcessor.extractVisibleText(state.elementTree);
    const selectableElements = state.selectorMap.size;

    return {
      ...counts,
      selectableElements,
      visibleTextLength: visibleText.length,
      visibleTextWords: visibleText.split(/\s+/).length,
    };
  }

  /**
   * Search for text in DOM state
   */
  static searchText(state: DOMState, searchText: string, caseSensitive = false) {
    return DOMTextProcessor.findTextNodes(state.elementTree, searchText, caseSensitive);
  }

  /**
   * Get enhanced CSS selector for an element by index
   */
  static getElementSelector(state: DOMState, index: number): string | null {
    const element = state.selectorMap.get(index);
    if (!element) {
      return null;
    }

    return DOMSelectorProcessor.enhancedCssSelectorForElement(element);
  }

  /**
   * Check if an element is a file uploader by index
   */
  static isFileUploader(state: DOMState, index: number, maxDepth = 3): boolean {
    const element = state.selectorMap.get(index);
    if (!element) {
      return false;
    }

    const enhanced = EnhancedDOMElement.fromDOMElement(element);
    return enhanced.isFileUploader(maxDepth);
  }

  /**
   * Get clickable elements as formatted string
   */
  static getClickableElementsString(state: DOMState, includeAttributes: string[] = []): string {
    return DOMTextProcessor.clickableElementsToString(state.elementTree, includeAttributes);
  }
}
