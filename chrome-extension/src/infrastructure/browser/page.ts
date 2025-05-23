import { createLogger } from '@src/infrastructure/monitoring/logger';
import { BrowserError, TabAccessError } from '@src/shared/types/errors';
import { getAppConfig } from '@src/shared/config';
import type { BrowserContextConfig } from '@src/background/browser/views';
import type { PageState } from '@src/background/browser/views';
import { DOMElementNode } from '@src/infrastructure/dom/base-node';
import { BrowserConnectionManager } from './connection-manager';
import { NavigationManager, type NavigationConfig } from './navigation-manager';
import { ElementInteractionManager } from './element-interaction-manager';
import { PageStateManager } from './page-state-manager';

const logger = createLogger('Page');

/**
 * Modern Page class that orchestrates browser operations through focused managers
 * Replaces the monolithic 1,317-line original with clean separation of concerns
 */
export class Page {
  private readonly _tabId: number;
  private readonly config: BrowserContextConfig;
  private readonly _validWebPage: boolean;

  // Infrastructure managers
  private readonly connectionManager: BrowserConnectionManager;
  private readonly navigationManager: NavigationManager;
  private readonly stateManager: PageStateManager;
  private elementInteractionManager: ElementInteractionManager | null = null;

  constructor(tabId: number, url: string, title: string, config: Partial<BrowserContextConfig> = {}) {
    this._tabId = tabId;
    this.config = { ...this.getDefaultConfig(), ...config };

    // chrome://newtab/, chrome://extensions are not valid web pages
    this._validWebPage = (tabId && url && url.startsWith('http')) || false;

    logger.info('Initializing page', {
      tabId,
      url: url.substring(0, 100),
      validWebPage: this._validWebPage,
    });

    // Initialize managers
    this.connectionManager = new BrowserConnectionManager(tabId);
    this.navigationManager = new NavigationManager(this.createNavigationConfig());

    const initialState = this.buildInitialState(tabId, url, title);
    this.stateManager = new PageStateManager(tabId, initialState, this.config.viewportExpansion);
  }

  // === Public Properties ===

  get tabId(): number {
    return this._tabId;
  }

  get validWebPage(): boolean {
    return this._validWebPage;
  }

  get attached(): boolean {
    return this._validWebPage && this.connectionManager.isConnected;
  }

  get url(): string {
    const page = this.connectionManager.page;
    if (page) {
      return page.url();
    }
    return this.stateManager.currentState.url;
  }

  // === Connection Management ===

  /**
   * Attach Puppeteer to the browser tab
   */
  async attachPuppeteer(): Promise<boolean> {
    if (!this._validWebPage) {
      logger.warn('Cannot attach to invalid web page', { tabId: this._tabId });
      return false;
    }

    try {
      const connected = await this.connectionManager.connect();

      if (connected && this.connectionManager.page) {
        // Initialize element interaction manager once connected
        this.elementInteractionManager = new ElementInteractionManager(this.connectionManager.page);
        logger.info('Page attached successfully', { tabId: this._tabId });
      }

      return connected;
    } catch (error) {
      logger.error('Failed to attach puppeteer', error, { tabId: this._tabId });
      throw new BrowserError(
        `Failed to attach to tab ${this._tabId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Detach from the browser
   */
  async detachPuppeteer(): Promise<void> {
    try {
      await this.connectionManager.disconnect();
      this.elementInteractionManager = null;
      this.stateManager.reset();
      logger.info('Page detached successfully', { tabId: this._tabId });
    } catch (error) {
      logger.error('Error during detach', error, { tabId: this._tabId });
      throw new BrowserError(
        `Failed to detach from tab ${this._tabId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // === State Management ===

  /**
   * Get current page state
   */
  async getState(useVision: boolean = false, cacheClickableElementsHashes: boolean = false): Promise<PageState> {
    try {
      await this.ensurePageAccessible();

      if (this.connectionManager.page) {
        await this.navigationManager.waitForPageLoad(this.connectionManager.page);
      }

      return await this.stateManager.getState(
        this.connectionManager.page,
        this._validWebPage,
        useVision,
        cacheClickableElementsHashes,
      );
    } catch (error) {
      logger.error('Failed to get page state', error, { tabId: this._tabId });
      throw new BrowserError(`Failed to get page state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Take a screenshot of the page
   */
  async takeScreenshot(fullPage: boolean = false): Promise<string | null> {
    const page = this.connectionManager.page;
    if (!page) {
      throw new TabAccessError('Page not connected for screenshot');
    }

    return await this.stateManager.takeScreenshot(page, fullPage);
  }

  /**
   * Get page title
   */
  async title(): Promise<string> {
    const page = this.connectionManager.page;
    if (page) {
      return await page.title();
    }
    return this.stateManager.currentState.title;
  }

  /**
   * Get page content
   */
  async getContent(): Promise<string> {
    const page = this.connectionManager.page;
    if (!page) {
      throw new TabAccessError('Page not connected for content retrieval');
    }
    return await page.content();
  }

  // === Navigation Operations ===

  /**
   * Navigate to a URL
   */
  async navigateTo(url: string): Promise<void> {
    const page = this.connectionManager.page;
    if (!page) {
      throw new TabAccessError('Page not connected for navigation');
    }

    await this.navigationManager.navigateTo(page, url);
  }

  /**
   * Refresh the page
   */
  async refreshPage(): Promise<void> {
    const page = this.connectionManager.page;
    if (!page) {
      throw new TabAccessError('Page not connected for refresh');
    }

    await this.navigationManager.refresh(page);
  }

  /**
   * Go back in browser history
   */
  async goBack(): Promise<void> {
    const page = this.connectionManager.page;
    if (!page) {
      throw new TabAccessError('Page not connected for back navigation');
    }

    await this.navigationManager.goBack(page);
  }

  /**
   * Go forward in browser history
   */
  async goForward(): Promise<void> {
    const page = this.connectionManager.page;
    if (!page) {
      throw new TabAccessError('Page not connected for forward navigation');
    }

    await this.navigationManager.goForward(page);
  }

  // === Element Interactions ===

  /**
   * Click on a DOM element
   */
  async clickElementNode(useVision: boolean, elementNode: DOMElementNode): Promise<void> {
    if (!this.elementInteractionManager) {
      throw new TabAccessError('Element interaction manager not available');
    }

    await this.elementInteractionManager.clickElement(elementNode, useVision);
  }

  /**
   * Input text into an element
   */
  async inputTextElementNode(useVision: boolean, elementNode: DOMElementNode, text: string): Promise<void> {
    if (!this.elementInteractionManager) {
      throw new TabAccessError('Element interaction manager not available');
    }

    await this.elementInteractionManager.inputText(elementNode, text, useVision);
  }

  /**
   * Send keyboard keys
   */
  async sendKeys(keys: string): Promise<void> {
    if (!this.elementInteractionManager) {
      throw new TabAccessError('Element interaction manager not available');
    }

    await this.elementInteractionManager.sendKeys(keys);
  }

  /**
   * Scroll page down
   */
  async scrollDown(amount?: number): Promise<void> {
    if (!this.elementInteractionManager) {
      throw new TabAccessError('Element interaction manager not available');
    }

    await this.elementInteractionManager.scrollDown(amount);
  }

  /**
   * Scroll page up
   */
  async scrollUp(amount?: number): Promise<void> {
    if (!this.elementInteractionManager) {
      throw new TabAccessError('Element interaction manager not available');
    }

    await this.elementInteractionManager.scrollUp(amount);
  }

  /**
   * Scroll to text on the page
   */
  async scrollToText(text: string): Promise<boolean> {
    if (!this.elementInteractionManager) {
      throw new TabAccessError('Element interaction manager not available');
    }

    return await this.elementInteractionManager.scrollToText(text);
  }

  /**
   * Get dropdown options
   */
  async getDropdownOptions(index: number): Promise<Array<{ index: number; text: string; value: string }>> {
    if (!this.elementInteractionManager) {
      throw new TabAccessError('Element interaction manager not available');
    }

    return await this.elementInteractionManager.getDropdownOptions(index);
  }

  /**
   * Select dropdown option
   */
  async selectDropdownOption(index: number, text: string): Promise<string> {
    if (!this.elementInteractionManager) {
      throw new TabAccessError('Element interaction manager not available');
    }

    return await this.elementInteractionManager.selectDropdownOption(index, text);
  }

  // === State Utilities ===

  /**
   * Get selector map for element lookup
   */
  getSelectorMap(): Map<number, DOMElementNode> {
    return this.stateManager.getSelectorMap();
  }

  /**
   * Get DOM element by index
   */
  getDomElementByIndex(index: number): DOMElementNode | null {
    return this.stateManager.getDomElementByIndex(index);
  }

  /**
   * Check if element is a file uploader
   */
  isFileUploader(elementNode: DOMElementNode, maxDepth?: number, currentDepth?: number): boolean {
    return this.stateManager.isFileUploader(elementNode, maxDepth, currentDepth);
  }

  /**
   * Remove highlights from the page
   */
  async removeHighlight(): Promise<void> {
    if (this.config.highlightElements && this._validWebPage) {
      // This is handled by the state manager
      logger.debug('Highlight removal handled by state manager');
    }
  }

  /**
   * Wait for page load
   */
  async waitForPageAndFramesLoad(timeoutOverride?: number): Promise<void> {
    const page = this.connectionManager.page;
    if (!page) {
      return;
    }

    await this.navigationManager.waitForPageLoad(page, timeoutOverride);
  }

  // === Private Helpers ===

  /**
   * Ensure page is accessible and recover if needed
   */
  private async ensurePageAccessible(): Promise<void> {
    if (!this._validWebPage) {
      return;
    }

    try {
      await this.connectionManager.ensurePageAccessible();
    } catch (error) {
      logger.error('Page accessibility check failed', error, { tabId: this._tabId });
      throw new TabAccessError(
        `Page is no longer accessible: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): BrowserContextConfig {
    const appConfig = getAppConfig();
    return {
      highlightElements: appConfig.browser.highlightElements,
      viewportExpansion: 0,
      allowedUrls: [],
      deniedUrls: [],
    };
  }

  /**
   * Create navigation configuration
   */
  private createNavigationConfig(): NavigationConfig {
    const appConfig = getAppConfig();
    return {
      allowedUrls: this.config.allowedUrls || [],
      deniedUrls: this.config.deniedUrls || [],
      navigationTimeout: appConfig.browser.defaultTimeout,
    };
  }

  /**
   * Build initial page state
   */
  private buildInitialState(tabId: number, url?: string, title?: string): PageState {
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
      tabId: tabId || 0,
      url: url || '',
      title: title || '',
      screenshot: null,
      pixelsAbove: 0,
      pixelsBelow: 0,
    };
  }

  /**
   * Static helper to build initial page state
   */
  static buildInitialState(tabId?: number, url?: string, title?: string): PageState {
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
      tabId: tabId || 0,
      url: url || '',
      title: title || '',
      screenshot: null,
      pixelsAbove: 0,
      pixelsBelow: 0,
    };
  }
}
