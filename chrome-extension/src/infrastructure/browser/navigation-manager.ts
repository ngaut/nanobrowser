import type { Page as PuppeteerPage } from 'puppeteer-core/lib/esm/puppeteer/api/Page.js';
import { createLogger } from '@src/infrastructure/monitoring/logger';
import { NavigationError } from '@src/shared/types/errors';
import { isUrlAllowed } from '@src/background/browser/util';
import { URLNotAllowedError } from '@src/background/browser/views';

const logger = createLogger('NavigationManager');

export interface NavigationConfig {
  allowedUrls: string[];
  deniedUrls: string[];
  navigationTimeout: number;
}

/**
 * Manages page navigation operations with safety checks
 */
export class NavigationManager {
  private readonly config: NavigationConfig;
  private loadPromise: Promise<void> | null = null;

  constructor(config: NavigationConfig) {
    this.config = config;
  }

  /**
   * Navigate to a URL with safety checks
   */
  async navigateTo(page: PuppeteerPage, url: string): Promise<void> {
    if (!page) {
      throw new NavigationError('Puppeteer page is not available');
    }

    logger.info('Navigating to URL', { url });

    // Check if URL is allowed
    if (!isUrlAllowed(url, this.config.allowedUrls, this.config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }

    try {
      await Promise.all([this.waitForPageLoad(page), page.goto(url)]);
      logger.info('Navigation completed successfully', { url });
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warn('Navigation timeout, but page might still be usable', { url, error: error.message });
        return;
      }

      logger.error('Navigation failed', error, { url });
      throw new NavigationError(
        `Failed to navigate to ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Refresh the current page
   */
  async refresh(page: PuppeteerPage): Promise<void> {
    if (!page) {
      throw new NavigationError('Puppeteer page is not available');
    }

    try {
      await Promise.all([this.waitForPageLoad(page), page.reload()]);
      logger.info('Page refresh completed');
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warn('Refresh timeout, but page might still be usable', { error: error.message });
        return;
      }

      logger.error('Page refresh failed', error);
      throw new NavigationError(`Failed to refresh page: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Go back in browser history
   */
  async goBack(page: PuppeteerPage): Promise<void> {
    if (!page) {
      throw new NavigationError('Puppeteer page is not available');
    }

    try {
      await Promise.all([this.waitForPageLoad(page), page.goBack()]);
      logger.info('Back navigation completed');
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warn('Back navigation timeout, but page might still be usable', { error: error.message });
        return;
      }

      logger.error('Back navigation failed', error);
      throw new NavigationError(`Failed to go back: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Go forward in browser history
   */
  async goForward(page: PuppeteerPage): Promise<void> {
    if (!page) {
      throw new NavigationError('Puppeteer page is not available');
    }

    try {
      await Promise.all([this.waitForPageLoad(page), page.goForward()]);
      logger.info('Forward navigation completed');
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warn('Forward navigation timeout, but page might still be usable', { error: error.message });
        return;
      }

      logger.error('Forward navigation failed', error);
      throw new NavigationError(`Failed to go forward: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Wait for page and all frames to load
   */
  async waitForPageLoad(page: PuppeteerPage, timeoutOverride?: number): Promise<void> {
    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }

    const timeout = timeoutOverride || this.config.navigationTimeout;

    this.loadPromise = this.performPageLoadWait(page, timeout);

    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  /**
   * Perform the actual page load waiting
   */
  private async performPageLoadWait(page: PuppeteerPage, timeout: number): Promise<void> {
    try {
      logger.debug('Waiting for page load', { timeout });

      // Wait for page load state
      await this.waitForPageLoadState(page, timeout);

      // Wait for stable network
      await this.waitForStableNetwork(page);

      // Check for navigation changes
      await this.checkAndHandleNavigation(page);

      logger.debug('Page load completed');
    } catch (error) {
      logger.warn('Page load wait failed', { error: error instanceof Error ? error.message : String(error) });
      // Don't throw here - let the caller decide how to handle
    }
  }

  /**
   * Wait for page load state
   */
  private async waitForPageLoadState(page: PuppeteerPage, timeout: number): Promise<void> {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout });
    } catch (error) {
      logger.debug('DOM content loaded timeout', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Wait for network to be stable
   */
  private async waitForStableNetwork(page: PuppeteerPage): Promise<void> {
    const stabilityTimeout = 2000;
    const requestTimeout = 10000;

    let requestCount = 0;
    let responseCount = 0;
    let timeoutId: NodeJS.Timeout;

    const isStable = (): boolean => requestCount === responseCount;

    const stabilityPromise = new Promise<void>(resolve => {
      const checkStability = () => {
        if (isStable()) {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            if (isStable()) {
              resolve();
            } else {
              checkStability();
            }
          }, stabilityTimeout);
        } else {
          setTimeout(checkStability, 100);
        }
      };
      checkStability();
    });

    const onRequest = () => {
      requestCount++;
      logger.debug('Network request detected', { requestCount, responseCount });
    };

    const onResponse = () => {
      responseCount++;
      logger.debug('Network response detected', { requestCount, responseCount });
    };

    try {
      page.on('request', onRequest);
      page.on('response', onResponse);

      await Promise.race([
        stabilityPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Network stability timeout')), requestTimeout),
        ),
      ]);

      logger.debug('Network stability achieved', { requestCount, responseCount });
    } catch (error) {
      logger.debug('Network stability timeout', {
        requestCount,
        responseCount,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      page.off('request', onRequest);
      page.off('response', onResponse);
      clearTimeout(timeoutId!);
    }
  }

  /**
   * Check and handle navigation changes
   */
  private async checkAndHandleNavigation(page: PuppeteerPage): Promise<void> {
    try {
      const currentUrl = page.url();
      const currentTitle = await page.title();

      logger.debug('Navigation state', {
        url: currentUrl,
        title: currentTitle.substring(0, 50) + (currentTitle.length > 50 ? '...' : ''),
      });
    } catch (error) {
      logger.debug('Failed to check navigation state', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
