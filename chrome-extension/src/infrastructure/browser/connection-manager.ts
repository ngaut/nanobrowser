import 'webextension-polyfill';
import {
  connect,
  ExtensionTransport,
  type ProtocolType,
} from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';
import type { Browser } from 'puppeteer-core/lib/esm/puppeteer/api/Browser.js';
import type { Page as PuppeteerPage } from 'puppeteer-core/lib/esm/puppeteer/api/Page.js';
import { createLogger } from '@src/infrastructure/monitoring/logger';
import { BrowserError } from '@src/shared/types/errors';

const logger = createLogger('BrowserConnectionManager');

/**
 * Manages Puppeteer browser connections and anti-detection measures
 */
export class BrowserConnectionManager {
  private browser: Browser | null = null;
  private puppeteerPage: PuppeteerPage | null = null;
  private readonly tabId: number;

  constructor(tabId: number) {
    this.tabId = tabId;
  }

  /**
   * Check if browser is connected
   */
  get isConnected(): boolean {
    return this.puppeteerPage !== null;
  }

  /**
   * Get the current page instance
   */
  get page(): PuppeteerPage | null {
    return this.puppeteerPage;
  }

  /**
   * Attach Puppeteer to the browser tab
   */
  async connect(): Promise<boolean> {
    if (this.puppeteerPage) {
      return true;
    }

    try {
      logger.info('Connecting to browser tab', { tabId: this.tabId });

      const browser = await connect({
        transport: await ExtensionTransport.connectTab(this.tabId),
        defaultViewport: null,
        protocol: 'cdp' as ProtocolType,
      });

      this.browser = browser;
      const [page] = await browser.pages();
      this.puppeteerPage = page;

      // Add anti-detection scripts
      await this.addAntiDetectionScripts();

      logger.info('Successfully connected to browser tab', { tabId: this.tabId });
      return true;
    } catch (error) {
      logger.error('Failed to connect to browser tab', error, { tabId: this.tabId });
      return false;
    }
  }

  /**
   * Disconnect from the browser
   */
  async disconnect(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.disconnect();
        logger.info('Disconnected from browser', { tabId: this.tabId });
      } catch (error) {
        logger.error('Error during browser disconnect', error, { tabId: this.tabId });
      } finally {
        this.browser = null;
        this.puppeteerPage = null;
      }
    }
  }

  /**
   * Check if page is still accessible and reconnect if needed
   */
  async ensurePageAccessible(): Promise<boolean> {
    if (!this.puppeteerPage) {
      return false;
    }

    try {
      // Test if page is still accessible
      await this.puppeteerPage.evaluate('1');
      return true;
    } catch (error) {
      logger.warn('Current page is no longer accessible, attempting recovery', {
        tabId: this.tabId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Try to get a new page from the browser
      if (this.browser) {
        try {
          const pages = await this.browser.pages();
          if (pages.length > 0) {
            this.puppeteerPage = pages[0];
            logger.info('Recovered page connection', { tabId: this.tabId });
            return true;
          }
        } catch (recoveryError) {
          logger.error('Failed to recover page connection', recoveryError, { tabId: this.tabId });
        }
      }

      throw new BrowserError('Browser closed: no valid pages available');
    }
  }

  /**
   * Add anti-detection scripts to prevent bot detection
   */
  private async addAntiDetectionScripts(): Promise<void> {
    if (!this.puppeteerPage) {
      return;
    }

    try {
      await this.puppeteerPage.evaluateOnNewDocument(`
        // Webdriver property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined
        });

        // Chrome runtime
        window.chrome = { runtime: {} };

        // Permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );

        // Shadow DOM
        (function () {
          const originalAttachShadow = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function attachShadow(options) {
            return originalAttachShadow.call(this, { ...options, mode: "open" });
          };
        })();
      `);

      logger.debug('Anti-detection scripts added', { tabId: this.tabId });
    } catch (error) {
      logger.warn('Failed to add anti-detection scripts', error, { tabId: this.tabId });
    }
  }
}
