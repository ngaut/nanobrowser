import type { Page as PuppeteerPage } from 'puppeteer-core/lib/esm/puppeteer/api/Page.js';
import { createLogger } from '@src/infrastructure/monitoring/logger';
import { BrowserError } from '@src/shared/types/errors';
import {
  getClickableElementsHashes,
  getClickableElements,
  hashDomElement,
} from '@src/background/dom/clickable/service';
import { DOMService } from '@src/infrastructure/dom/dom-service';
import { DOMElementNode, type DOMState } from '@src/infrastructure/dom/base-node';
import type { PageState } from '@src/background/browser/views';

const logger = createLogger('PageStateManager');

/**
 * Cached clickable elements hashes for the last state
 */
export class CachedStateClickableElementsHashes {
  url: string;
  hashes: Set<string>;

  constructor(url: string, hashes: Set<string>) {
    this.url = url;
    this.hashes = hashes;
  }
}

/**
 * Manages page state including DOM elements, screenshots, and caching
 */
export class PageStateManager {
  private readonly tabId: number;
  private state: PageState;
  private cachedState: PageState | null = null;
  private cachedStateClickableElementsHashes: CachedStateClickableElementsHashes | null = null;
  private readonly viewportExpansion: number;

  constructor(tabId: number, initialState: PageState, viewportExpansion: number = 0) {
    this.tabId = tabId;
    this.state = initialState;
    this.viewportExpansion = viewportExpansion;
  }

  /**
   * Get current state
   */
  get currentState(): PageState {
    return this.state;
  }

  /**
   * Get cached state
   */
  get cached(): PageState | null {
    return this.cachedState;
  }

  /**
   * Get the current page state with optional vision and caching
   */
  async getState(
    page: PuppeteerPage | null,
    validWebPage: boolean,
    useVision: boolean = false,
    cacheClickableElementsHashes: boolean = false,
  ): Promise<PageState> {
    if (!validWebPage) {
      // Return the initial state
      return this.buildInitialState();
    }

    if (!page) {
      logger.warn('Page not available, returning cached state');
      return this.state;
    }

    try {
      const updatedState = await this.updateState(page, useVision);

      // Handle clickable elements caching
      if (cacheClickableElementsHashes) {
        await this.handleClickableElementsCaching(updatedState);
      }

      // Save the updated state as the cached state
      this.cachedState = updatedState;
      this.state = updatedState;

      return updatedState;
    } catch (error) {
      logger.error('Failed to get state', error);
      return this.state; // Return last known good state
    }
  }

  /**
   * Update the page state
   */
  private async updateState(
    page: PuppeteerPage,
    useVision: boolean = true,
    focusElement: number = -1,
  ): Promise<PageState> {
    try {
      // Remove existing highlights
      await this.removeHighlights();

      // Get DOM content
      const content = await this.getClickableElements(useVision, focusElement);
      if (!content) {
        logger.warn('Failed to get clickable elements');
        return this.state;
      }

      logger.debug('DOM content retrieved', {
        selectorMapSize: content.selectorMap.size,
        elementTreeTag: content.elementTree?.tagName,
      });

      // Take screenshot if needed
      const screenshot = useVision ? await this.takeScreenshot(page) : null;
      const [pixelsAbove, pixelsBelow] = await this.getScrollInfo();

      // Update the state
      const newState: PageState = {
        elementTree: content.elementTree,
        selectorMap: content.selectorMap,
        tabId: this.tabId,
        url: page.url() || '',
        title: (await page.title()) || '',
        screenshot,
        pixelsAbove,
        pixelsBelow,
      };

      return newState;
    } catch (error) {
      logger.error('Failed to update state', error);
      return this.state;
    }
  }

  /**
   * Take a screenshot of the page
   */
  async takeScreenshot(page: PuppeteerPage, fullPage: boolean = false): Promise<string | null> {
    try {
      logger.debug('Taking screenshot', { fullPage });

      // Disable animations/transitions for consistent screenshots
      await page.evaluate(() => {
        const styleId = 'nanobrowser-disable-animations';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `
            *, *::before, *::after {
              animation: none !important;
              transition: none !important;
            }
          `;
          document.head.appendChild(style);
        }
      });

      // Take the screenshot using JPEG format with 80% quality
      const screenshot = await page.screenshot({
        fullPage,
        encoding: 'base64',
        type: 'jpeg',
        quality: 80, // Good balance between quality and file size
      });

      // Clean up the style element
      await page.evaluate(() => {
        const style = document.getElementById('nanobrowser-disable-animations');
        if (style) {
          style.remove();
        }
      });

      logger.debug('Screenshot captured successfully');
      return screenshot as string;
    } catch (error) {
      logger.error('Failed to take screenshot', error);
      throw new BrowserError(`Failed to take screenshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get clickable elements from the page
   */
  private async getClickableElements(showHighlightElements: boolean, focusElement: number): Promise<DOMState | null> {
    return DOMService.getClickableElements(
      this.tabId,
      this.state.url,
      showHighlightElements,
      focusElement,
      this.viewportExpansion,
    );
  }

  /**
   * Remove highlights from the page
   */
  private async removeHighlights(): Promise<void> {
    try {
      await DOMService.removeHighlights(this.tabId);
    } catch (error) {
      logger.debug('Failed to remove highlights', {
        tabId: this.tabId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get scroll information for the page
   */
  private async getScrollInfo(): Promise<[number, number]> {
    try {
      return await DOMService.getScrollInfo(this.tabId);
    } catch (error) {
      logger.debug('Failed to get scroll info', {
        tabId: this.tabId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [0, 0];
    }
  }

  /**
   * Handle clickable elements caching
   */
  private async handleClickableElementsCaching(updatedState: PageState): Promise<void> {
    try {
      // If we are on the same URL as the last state, we can use the cached hashes
      if (this.cachedStateClickableElementsHashes && this.cachedStateClickableElementsHashes.url === updatedState.url) {
        // Get clickable elements from the updated state
        const updatedStateClickableElements = getClickableElements(updatedState.elementTree);

        // Mark elements as new if they weren't in the previous state
        for (const domElement of updatedStateClickableElements) {
          const hash = await hashDomElement(domElement);
          domElement.isNew = !this.cachedStateClickableElementsHashes.hashes.has(hash);
        }
      }

      // Cache the new hashes
      const newHashes = await getClickableElementsHashes(updatedState.elementTree);
      this.cachedStateClickableElementsHashes = new CachedStateClickableElementsHashes(updatedState.url, newHashes);
    } catch (error) {
      logger.error('Failed to handle clickable elements caching', error);
    }
  }

  /**
   * Build initial state for invalid web pages
   */
  private buildInitialState(): PageState {
    return {
      elementTree: new DOMElementNode({
        tagName: 'root',
        isVisible: true,
        parent: null,
        xpath: '',
        attributes: {},
        children: [],
      }),
      selectorMap: new Map(),
      tabId: this.tabId,
      url: '',
      title: '',
      screenshot: null,
      pixelsAbove: 0,
      pixelsBelow: 0,
    };
  }

  /**
   * Get selector map for element lookup
   */
  getSelectorMap(): Map<number, DOMElementNode> {
    return this.state.selectorMap;
  }

  /**
   * Get DOM element by index
   */
  getDomElementByIndex(index: number): DOMElementNode | null {
    return this.state.selectorMap.get(index) || null;
  }

  /**
   * Check if element is a file uploader
   */
  isFileUploader(elementNode: DOMElementNode, maxDepth = 3, currentDepth = 0): boolean {
    if (currentDepth > maxDepth) {
      return false;
    }

    // Check if the element itself is a file input
    if (elementNode.tagName.toLowerCase() === 'input' && elementNode.attributes['type']?.toLowerCase() === 'file') {
      return true;
    }

    // Check for common file upload indicators
    const attributes = elementNode.attributes;
    const hasFileUploadAttributes =
      attributes['accept'] ||
      attributes['data-file-upload'] ||
      attributes['data-upload'] ||
      (attributes['class'] &&
        (attributes['class'].includes('file-upload') ||
          attributes['class'].includes('file-input') ||
          attributes['class'].includes('upload')));

    if (hasFileUploadAttributes) {
      return true;
    }

    // Recursively check children
    for (const child of elementNode.children) {
      if (this.isFileUploader(child, maxDepth, currentDepth + 1)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Reset state to initial
   */
  reset(): void {
    this.state = this.buildInitialState();
    this.cachedState = null;
    this.cachedStateClickableElementsHashes = null;
  }
}
