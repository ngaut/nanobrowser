import type { Page as PuppeteerPage } from 'puppeteer-core/lib/esm/puppeteer/api/Page.js';
import type { ElementHandle } from 'puppeteer-core/lib/esm/puppeteer/api/ElementHandle.js';
import type { KeyInput } from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';
import { createLogger } from '@src/infrastructure/monitoring/logger';
import { ActionExecutionError } from '@src/shared/types/errors';
import type { DOMElementNode } from '@src/infrastructure/dom/base-node';

const logger = createLogger('ElementInteractionManager');

/**
 * Manages interactions with DOM elements (clicking, typing, scrolling)
 */
export class ElementInteractionManager {
  private readonly page: PuppeteerPage;

  constructor(page: PuppeteerPage) {
    this.page = page;
  }

  /**
   * Click on a DOM element
   */
  async clickElement(elementNode: DOMElementNode, useVision: boolean = false): Promise<void> {
    const element = await this.locateElement(elementNode);
    if (!element) {
      throw new ActionExecutionError(`Element not found for clicking`, {
        tagName: elementNode.tagName,
        xpath: elementNode.xpath,
      });
    }

    try {
      logger.info('Clicking element', {
        tagName: elementNode.tagName,
        xpath: elementNode.xpath,
      });

      await this.waitForElementStability(element);
      await this.scrollIntoViewIfNeeded(element);

      // Use force click for better reliability
      await element.click();

      logger.info('Element clicked successfully', {
        tagName: elementNode.tagName,
      });
    } catch (error) {
      logger.error('Failed to click element', error, {
        tagName: elementNode.tagName,
        xpath: elementNode.xpath,
      });
      throw new ActionExecutionError(
        `Failed to click element: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Input text into an element
   */
  async inputText(elementNode: DOMElementNode, text: string, useVision: boolean = false): Promise<void> {
    const element = await this.locateElement(elementNode);
    if (!element) {
      throw new ActionExecutionError(`Element not found for text input`, {
        tagName: elementNode.tagName,
        xpath: elementNode.xpath,
      });
    }

    try {
      logger.info('Inputting text into element', {
        tagName: elementNode.tagName,
        textLength: text.length,
      });

      await this.waitForElementStability(element);
      await this.scrollIntoViewIfNeeded(element);

      // Focus on the element first
      await element.focus();
      await this.page.waitForTimeout(100);

      // Clear existing content and type new text
      await element.click({ clickCount: 3 }); // Select all
      await element.type(text, { delay: 20 });

      logger.info('Text input completed', {
        tagName: elementNode.tagName,
      });
    } catch (error) {
      logger.error('Failed to input text', error, {
        tagName: elementNode.tagName,
        xpath: elementNode.xpath,
      });
      throw new ActionExecutionError(`Failed to input text: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Send keyboard keys to the page
   */
  async sendKeys(keys: string): Promise<void> {
    try {
      logger.info('Sending keys', { keys });

      const keyInputs = this.parseKeys(keys);
      for (const key of keyInputs) {
        await this.page.keyboard.press(key);
        await this.page.waitForTimeout(50);
      }

      logger.info('Keys sent successfully');
    } catch (error) {
      logger.error('Failed to send keys', error, { keys });
      throw new ActionExecutionError(`Failed to send keys: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Scroll page down
   */
  async scrollDown(amount?: number): Promise<void> {
    const scrollAmount = amount || 300;
    try {
      await this.page.evaluate(pixels => {
        window.scrollBy(0, pixels);
      }, scrollAmount);
      logger.debug('Scrolled down', { amount: scrollAmount });
    } catch (error) {
      logger.error('Failed to scroll down', error, { amount: scrollAmount });
      throw new ActionExecutionError(
        `Failed to scroll down: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Scroll page up
   */
  async scrollUp(amount?: number): Promise<void> {
    const scrollAmount = amount || 300;
    try {
      await this.page.evaluate(pixels => {
        window.scrollBy(0, -pixels);
      }, scrollAmount);
      logger.debug('Scrolled up', { amount: scrollAmount });
    } catch (error) {
      logger.error('Failed to scroll up', error, { amount: scrollAmount });
      throw new ActionExecutionError(`Failed to scroll up: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Scroll to find text on the page
   */
  async scrollToText(text: string): Promise<boolean> {
    try {
      logger.info('Scrolling to find text', { text: text.substring(0, 50) });

      const result = await this.page.evaluate(searchText => {
        const xpath = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${searchText.toLowerCase()}')]`;
        const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
          .singleNodeValue as Element;

        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        }
        return false;
      }, text);

      if (result) {
        logger.info('Successfully scrolled to text', { text: text.substring(0, 50) });
        await this.page.waitForTimeout(1000); // Wait for smooth scroll
      } else {
        logger.warn('Text not found for scrolling', { text: text.substring(0, 50) });
      }

      return result;
    } catch (error) {
      logger.error('Failed to scroll to text', error, { text: text.substring(0, 50) });
      return false;
    }
  }

  /**
   * Get dropdown options for a select element
   */
  async getDropdownOptions(elementIndex: number): Promise<Array<{ index: number; text: string; value: string }>> {
    try {
      const options = await this.page.evaluate(index => {
        const elements = Array.from(document.querySelectorAll('[data-nanobrowser-index]'));
        const element = elements.find(
          el => parseInt(el.getAttribute('data-nanobrowser-index') || '0') === index,
        ) as HTMLSelectElement;

        if (!element || element.tagName !== 'SELECT') {
          return [];
        }

        return Array.from(element.options).map((option, idx) => ({
          index: idx,
          text: option.text.trim(),
          value: option.value,
        }));
      }, elementIndex);

      logger.debug('Retrieved dropdown options', { elementIndex, optionCount: options.length });
      return options;
    } catch (error) {
      logger.error('Failed to get dropdown options', error, { elementIndex });
      throw new ActionExecutionError(
        `Failed to get dropdown options: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Select an option from a dropdown
   */
  async selectDropdownOption(elementIndex: number, optionText: string): Promise<string> {
    try {
      logger.info('Selecting dropdown option', { elementIndex, optionText });

      const result = await this.page.evaluate(
        (index, text) => {
          const elements = Array.from(document.querySelectorAll('[data-nanobrowser-index]'));
          const element = elements.find(
            el => parseInt(el.getAttribute('data-nanobrowser-index') || '0') === index,
          ) as HTMLSelectElement;

          if (!element || element.tagName !== 'SELECT') {
            return 'Element not found or not a select element';
          }

          const option = Array.from(element.options).find(opt => opt.text.toLowerCase().includes(text.toLowerCase()));

          if (!option) {
            return `Option containing "${text}" not found`;
          }

          element.value = option.value;
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return `Selected: ${option.text}`;
        },
        elementIndex,
        optionText,
      );

      logger.info('Dropdown option selected', { elementIndex, result });
      return result;
    } catch (error) {
      logger.error('Failed to select dropdown option', error, { elementIndex, optionText });
      throw new ActionExecutionError(
        `Failed to select dropdown option: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Locate an element on the page
   */
  private async locateElement(elementNode: DOMElementNode): Promise<ElementHandle | null> {
    try {
      // Try by index first (most reliable)
      if (elementNode.index !== undefined) {
        const byIndex = await this.page.$(`[data-nanobrowser-index="${elementNode.index}"]`);
        if (byIndex) {
          return byIndex;
        }
      }

      // Try by XPath
      if (elementNode.xpath) {
        const [byXPath] = await this.page.$x(elementNode.xpath);
        if (byXPath) {
          return byXPath as ElementHandle;
        }
      }

      logger.warn('Element not found', {
        tagName: elementNode.tagName,
        index: elementNode.index,
        xpath: elementNode.xpath,
      });
      return null;
    } catch (error) {
      logger.error('Error locating element', error, {
        tagName: elementNode.tagName,
        index: elementNode.index,
      });
      return null;
    }
  }

  /**
   * Wait for element to be stable before interaction
   */
  private async waitForElementStability(element: ElementHandle, timeout = 1000): Promise<void> {
    try {
      let lastBoundingBox = await element.boundingBox();
      await this.page.waitForTimeout(100);

      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        const currentBoundingBox = await element.boundingBox();

        if (this.boundingBoxesEqual(lastBoundingBox, currentBoundingBox)) {
          logger.debug('Element stability achieved');
          return;
        }

        lastBoundingBox = currentBoundingBox;
        await this.page.waitForTimeout(50);
      }

      logger.debug('Element stability timeout, proceeding anyway');
    } catch (error) {
      logger.debug('Element stability check failed, proceeding anyway', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Scroll element into view if needed
   */
  private async scrollIntoViewIfNeeded(element: ElementHandle, timeout = 1000): Promise<void> {
    try {
      await element.evaluate((el: Element) => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      await this.page.waitForTimeout(Math.min(timeout, 500)); // Wait for scroll animation
      logger.debug('Element scrolled into view');
    } catch (error) {
      logger.debug('Failed to scroll element into view', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Parse key string into KeyInput array
   */
  private parseKeys(keys: string): KeyInput[] {
    const keyMap: Record<string, KeyInput> = {
      ENTER: 'Enter',
      TAB: 'Tab',
      ESCAPE: 'Escape',
      SPACE: 'Space',
      BACKSPACE: 'Backspace',
      DELETE: 'Delete',
      ARROW_UP: 'ArrowUp',
      ARROW_DOWN: 'ArrowDown',
      ARROW_LEFT: 'ArrowLeft',
      ARROW_RIGHT: 'ArrowRight',
      HOME: 'Home',
      END: 'End',
      PAGE_UP: 'PageUp',
      PAGE_DOWN: 'PageDown',
    };

    return keys.split('+').map(key => {
      const upperKey = key.trim().toUpperCase();
      return keyMap[upperKey] || (key.length === 1 ? (key as KeyInput) : (key as KeyInput));
    });
  }

  /**
   * Check if two bounding boxes are equal
   */
  private boundingBoxesEqual(box1: any, box2: any): boolean {
    if (!box1 || !box2) return box1 === box2;

    return (
      Math.abs(box1.x - box2.x) < 1 &&
      Math.abs(box1.y - box2.y) < 1 &&
      Math.abs(box1.width - box2.width) < 1 &&
      Math.abs(box1.height - box2.height) < 1
    );
  }
}
