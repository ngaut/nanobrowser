import 'webextension-polyfill';
import {
  type BrowserContextConfig,
  type BrowserState,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  type TabInfo,
  URLNotAllowedError,
} from './views';
import Page, { build_initial_state } from './page';
import { createLogger } from '@src/background/log';
import { isUrlAllowed } from './util';

const logger = createLogger('BrowserContext');
export default class BrowserContext {
  private _config: BrowserContextConfig;
  private _currentTabId: number | null = null;
  private _attachedPages: Map<number, Page> = new Map();
  private _pluginOwnedTabs: Set<number> = new Set();
  private _initialUserTabs: Set<number> = new Set();
  private _sessionInitialized: boolean = false;

  constructor(config: Partial<BrowserContextConfig>) {
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
  }

  public getConfig(): BrowserContextConfig {
    return this._config;
  }

  public updateConfig(config: Partial<BrowserContextConfig>): void {
    this._config = { ...this._config, ...config };
  }

  public updateCurrentTabId(tabId: number): void {
    // only update tab id, but don't attach it.
    this._currentTabId = tabId;
  }

  private async _getOrCreatePage(tab: chrome.tabs.Tab, forceUpdate = false): Promise<Page> {
    if (!tab.id) {
      throw new Error('Tab ID is not available');
    }

    const existingPage = this._attachedPages.get(tab.id);
    if (existingPage) {
      logger.info('getOrCreatePage', tab.id, 'already attached');
      if (!forceUpdate) {
        return existingPage;
      }
      // detach the page and remove it from the attached pages if forceUpdate is true
      await existingPage.detachPuppeteer();
      this._attachedPages.delete(tab.id);
    }
    logger.info('getOrCreatePage', tab.id, 'creating new page');
    return new Page(tab.id, tab.url || '', tab.title || '', this._config);
  }

  public async cleanup(): Promise<void> {
    const currentPage = await this.getCurrentPage();
    currentPage?.removeHighlight();

    // Get all current tab IDs to identify stale references
    const currentTabIds = await this.getAllTabIds();

    // Remove stale page references
    const staleTabIds: number[] = [];
    for (const tabId of this._attachedPages.keys()) {
      if (!currentTabIds.has(tabId)) {
        staleTabIds.push(tabId);
      }
    }

    // Clean up stale references
    for (const staleTabId of staleTabIds) {
      logger.info(`Cleaning up stale page reference for tab ${staleTabId}`);
      const stalePage = this._attachedPages.get(staleTabId);
      if (stalePage) {
        try {
          await stalePage.detachPuppeteer();
        } catch (error) {
          logger.warning(`Error detaching stale page ${staleTabId}:`, error);
        }
      }
      this._attachedPages.delete(staleTabId);
      this._pluginOwnedTabs.delete(staleTabId); // Also remove from plugin-owned tabs
    }

    // detach all remaining pages
    for (const page of this._attachedPages.values()) {
      try {
        await page.detachPuppeteer();
      } catch (error) {
        logger.warning('Error during page cleanup:', error);
      }
    }
    this._attachedPages.clear();
    this._currentTabId = null;

    // Reset session state
    this._pluginOwnedTabs.clear();
    this._initialUserTabs.clear();
    this._sessionInitialized = false;
  }

  public async attachPage(page: Page): Promise<boolean> {
    // check if page is already attached
    if (this._attachedPages.has(page.tabId)) {
      logger.info('attachPage', page.tabId, 'already attached');
      return true;
    }

    if (await page.attachPuppeteer()) {
      logger.info('attachPage', page.tabId, 'attached');
      // add page to managed pages
      this._attachedPages.set(page.tabId, page);
      return true;
    }
    return false;
  }

  public async detachPage(tabId: number): Promise<void> {
    // detach page
    const page = this._attachedPages.get(tabId);
    if (page) {
      await page.detachPuppeteer();
      // remove page from managed pages
      this._attachedPages.delete(tabId);
    }
  }

  public async getCurrentPage(recursionDepth = 0): Promise<Page> {
    // Prevent infinite recursion
    if (recursionDepth > 3) {
      throw new Error('Maximum recursion depth exceeded while getting current page. Unable to find valid tab.');
    }

    // Ensure session is initialized
    await this.initializeSession();

    // 1. If _currentTabId not set, query the active tab and attach it
    if (!this._currentTabId) {
      let activeTab: chrome.tabs.Tab;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        // No active tab found, create a new one
        const newTab = await chrome.tabs.create({ url: this._config.homePageUrl });
        if (!newTab.id) {
          throw new Error('No tab ID available');
        }
        this._pluginOwnedTabs.add(newTab.id);
        activeTab = newTab;
      } else {
        // Use the active tab (already marked as plugin-owned in initializeSession)
        activeTab = tab;
      }

      logger.info('active tab', activeTab.id, activeTab.url, activeTab.title);
      const page = await this._getOrCreatePage(activeTab);
      await this.attachPage(page);
      this._currentTabId = activeTab.id || null;
      return page;
    }

    // 2. If _currentTabId is set but not in attachedPages, attach the tab
    const existingPage = this._attachedPages.get(this._currentTabId);
    if (!existingPage) {
      try {
        const tab = await chrome.tabs.get(this._currentTabId);
        const page = await this._getOrCreatePage(tab);
        // set current tab id to null if the page is not attached successfully
        await this.attachPage(page);
        return page;
      } catch (error) {
        logger.warning(`Current tab ${this._currentTabId} is no longer valid:`, error);
        // Clean up invalid tab reference
        this._attachedPages.delete(this._currentTabId);
        this._currentTabId = null;
        return this.getCurrentPage(recursionDepth + 1); // Recursive call with depth tracking
      }
    }

    // 3. Return existing page from attachedPages
    return existingPage;
  }

  /**
   * Get all tab IDs from the browser and the current window.
   * @returns A set of tab IDs.
   */
  public async getAllTabIds(): Promise<Set<number>> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return new Set(tabs.map(tab => tab.id).filter(id => id !== undefined));
  }

  /**
   * Wait for tab events to occur after a tab is created or updated.
   * @param tabId - The ID of the tab to wait for events on.
   * @param options - An object containing options for the wait.
   * @returns A promise that resolves when the tab events occur.
   */
  private async waitForTabEvents(
    tabId: number,
    options: {
      waitForUpdate?: boolean;
      waitForActivation?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<void> {
    const { waitForUpdate = true, waitForActivation = true, timeoutMs = 5000 } = options;

    const promises: Promise<void>[] = [];
    const cleanupFunctions: (() => void)[] = [];

    if (waitForUpdate) {
      const updatePromise = new Promise<void>(resolve => {
        let hasUrl = false;
        let hasTitle = false;
        let isComplete = false;

        const onUpdatedHandler = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
          if (updatedTabId !== tabId) return;

          if (changeInfo.url) hasUrl = true;
          if (changeInfo.title) hasTitle = true;
          if (changeInfo.status === 'complete') isComplete = true;

          // Resolve when we have all the information we need
          if (hasUrl && hasTitle && isComplete) {
            resolve();
          }
        };

        chrome.tabs.onUpdated.addListener(onUpdatedHandler);

        // Store cleanup function
        cleanupFunctions.push(() => {
          chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
        });

        // Check current state
        chrome.tabs
          .get(tabId)
          .then(tab => {
            if (tab.url) hasUrl = true;
            if (tab.title) hasTitle = true;
            if (tab.status === 'complete') isComplete = true;

            if (hasUrl && hasTitle && isComplete) {
              resolve();
            }
          })
          .catch(error => {
            logger.warning(`Tab ${tabId} is no longer valid during waitForTabEvents:`, error);
            resolve(); // Resolve anyway to avoid hanging
          });
      });
      promises.push(updatePromise);
    }

    if (waitForActivation) {
      const activatedPromise = new Promise<void>(resolve => {
        const onActivatedHandler = (activeInfo: chrome.tabs.TabActiveInfo) => {
          if (activeInfo.tabId === tabId) {
            resolve();
          }
        };

        chrome.tabs.onActivated.addListener(onActivatedHandler);

        // Store cleanup function
        cleanupFunctions.push(() => {
          chrome.tabs.onActivated.removeListener(onActivatedHandler);
        });

        // Check current state
        chrome.tabs
          .get(tabId)
          .then(tab => {
            if (tab.active) {
              resolve();
            }
          })
          .catch(error => {
            logger.warning(`Tab ${tabId} is no longer valid during activation check:`, error);
            resolve(); // Resolve anyway to avoid hanging
          });
      });
      promises.push(activatedPromise);
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tab operation timed out after ${timeoutMs} ms`)), timeoutMs),
    );

    try {
      await Promise.race([Promise.all(promises), timeoutPromise]);
    } finally {
      // Always clean up event listeners, even if we timeout or error
      cleanupFunctions.forEach(cleanup => {
        try {
          cleanup();
        } catch (error) {
          logger.warning('Error during event listener cleanup:', error);
        }
      });
    }
  }

  public async switchTab(tabId: number): Promise<Page> {
    logger.info('switchTab', tabId);

    // SECURITY CHECK: Only allow switching to plugin-owned tabs
    if (this.isUserTab(tabId)) {
      throw new Error(`Cannot switch to user tab ${tabId}. Plugin can only operate on tabs it created.`);
    }

    try {
      // Validate tab exists first
      await chrome.tabs.get(tabId);

      await chrome.tabs.update(tabId, { active: true });
      await this.waitForTabEvents(tabId, { waitForUpdate: false });

      const tab = await chrome.tabs.get(tabId);
      const page = await this._getOrCreatePage(tab);
      await this.attachPage(page);
      this._currentTabId = tabId;
      return page;
    } catch (error) {
      logger.error(`Failed to switch to tab ${tabId}:`, error);

      // Clean up any stale reference
      this._attachedPages.delete(tabId);
      if (this._currentTabId === tabId) {
        this._currentTabId = null;
      }

      throw new Error(
        `Tab ${tabId} is no longer valid or accessible: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async navigateTo(url: string): Promise<void> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }

    const page = await this.getCurrentPage();
    if (!page) {
      await this.openTab(url);
      return;
    }
    // if page is attached, use puppeteer to navigate to the url
    if (page.attached) {
      await page.navigateTo(url);
      return;
    }
    //  Use chrome.tabs.update only if the page is not attached
    const tabId = page.tabId;

    try {
      // Update tab and wait for events
      await chrome.tabs.update(tabId, { url, active: true });
      await this.waitForTabEvents(tabId);

      // Reattach the page after navigation completes
      const updatedTab = await chrome.tabs.get(tabId);
      const updatedPage = await this._getOrCreatePage(updatedTab, true);
      await this.attachPage(updatedPage);
      this._currentTabId = tabId;
    } catch (error) {
      logger.error(`Failed to navigate tab ${tabId} to ${url}:`, error);
      throw new Error(`Navigation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async openTab(url: string): Promise<Page> {
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`Open tab failed. URL: ${url} is not allowed`);
    }

    try {
      // Create the new tab
      const tab = await chrome.tabs.create({ url, active: true });
      if (!tab.id) {
        throw new Error('No tab ID available');
      }

      // Mark this tab as plugin-owned
      this._pluginOwnedTabs.add(tab.id);
      logger.info(`Created plugin-owned tab ${tab.id} for URL: ${url}`);

      // Wait for tab events
      await this.waitForTabEvents(tab.id);

      // Get updated tab information
      const updatedTab = await chrome.tabs.get(tab.id);
      // Create and attach the page after tab is fully loaded and activated
      const page = await this._getOrCreatePage(updatedTab);
      await this.attachPage(page);
      this._currentTabId = tab.id;

      return page;
    } catch (error) {
      logger.error(`Failed to open tab with URL ${url}:`, error);
      throw new Error(`Failed to open tab: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async closeTab(tabId: number): Promise<void> {
    // SECURITY CHECK: Only allow closing plugin-owned tabs
    if (this.isUserTab(tabId)) {
      throw new Error(`Cannot close user tab ${tabId}. Plugin can only operate on tabs it created.`);
    }

    await this.detachPage(tabId);
    await chrome.tabs.remove(tabId);

    // Remove from plugin-owned tabs
    this._pluginOwnedTabs.delete(tabId);

    // update current tab id if needed
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  /**
   * Remove a tab from the attached pages map. This will not run detachPuppeteer.
   * @param tabId - The ID of the tab to remove.
   */
  public removeAttachedPage(tabId: number): void {
    this._attachedPages.delete(tabId);
    // update current tab id if needed
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  public async getTabInfos(): Promise<TabInfo[]> {
    // IMPORTANT: Only return plugin-owned tabs, not user tabs
    return await this.getPluginTabInfos();
  }

  public async getState(useVision = false, cacheClickableElementsHashes = false): Promise<BrowserState> {
    const currentPage = await this.getCurrentPage();

    const pageState = !currentPage
      ? build_initial_state()
      : await currentPage.getState(useVision, cacheClickableElementsHashes);
    const tabInfos = await this.getTabInfos();
    const browserState: BrowserState = {
      ...pageState,
      tabs: tabInfos,
      browser_errors: [],
    };
    return browserState;
  }

  public async removeHighlight(): Promise<void> {
    const page = await this.getCurrentPage();
    if (page) {
      await page.removeHighlight();
    }
  }

  /**
   * Initialize session by recording existing user tabs
   * These tabs should never be touched by the plugin, EXCEPT the current active tab
   */
  public async initializeSession(): Promise<void> {
    if (this._sessionInitialized) {
      return;
    }

    // Get current active tab - this should be available for plugin operation
    const [currentActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Record all existing tabs as user tabs that should not be touched,
    // EXCEPT the current active tab which the user wants to operate on
    const existingTabs = await chrome.tabs.query({});
    this._initialUserTabs = new Set(
      existingTabs
        .filter(tab => tab.id !== undefined && tab.id !== currentActiveTab?.id) // Exclude current active tab
        .map(tab => tab.id!), // Safe to use ! since we filtered out undefined
    );

    // The current active tab becomes plugin-owned immediately
    if (currentActiveTab?.id) {
      this._pluginOwnedTabs.add(currentActiveTab.id);
      logger.info(`Current active tab ${currentActiveTab.id} adopted as plugin-owned for task operation`);
    }

    this._sessionInitialized = true;

    logger.info(
      `Session initialized. Protecting ${this._initialUserTabs.size} existing user tabs. Active tab ${currentActiveTab?.id} available for plugin operation.`,
    );
  }

  /**
   * Check if a tab belongs to the plugin (was created by plugin during this session)
   */
  public isPluginOwnedTab(tabId: number): boolean {
    return this._pluginOwnedTabs.has(tabId);
  }

  /**
   * Check if a tab is a user tab that should not be touched
   */
  public isUserTab(tabId: number): boolean {
    return this._initialUserTabs.has(tabId);
  }

  /**
   * Get only plugin-owned tabs
   */
  public async getPluginTabInfos(): Promise<TabInfo[]> {
    const allTabs = await chrome.tabs.query({});
    const pluginTabs: TabInfo[] = [];

    for (const tab of allTabs) {
      if (tab.id && tab.url && tab.title && this.isPluginOwnedTab(tab.id)) {
        pluginTabs.push({
          id: tab.id,
          url: tab.url,
          title: tab.title,
        });
      }
    }
    return pluginTabs;
  }

  /**
   * Adopt a tab as plugin-owned (e.g., when it's created by clicking a link)
   * This should only be used for tabs that are created as a result of plugin actions
   */
  public async adoptTab(tabId: number): Promise<void> {
    if (!this.isUserTab(tabId) && !this.isPluginOwnedTab(tabId)) {
      this._pluginOwnedTabs.add(tabId);
      logger.info(`Adopted tab ${tabId} as plugin-owned`);
    } else if (this.isUserTab(tabId)) {
      throw new Error(`Cannot adopt user tab ${tabId}. This tab existed before the plugin session started.`);
    }
    // If already plugin-owned, do nothing
  }
}
