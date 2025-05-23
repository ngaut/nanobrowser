import { DOMElementNode } from './base-node';
import { DOMTextProcessor } from './text-processor';
import { DOMSelectorProcessor } from './selector-processor';

/**
 * Enhanced DOM Element with additional utility methods
 * Extends the base DOMElementNode with text processing and selector capabilities
 */
export class EnhancedDOMElement extends DOMElementNode {
  /**
   * Get all text content until the next clickable element
   */
  getAllTextTillNextClickableElement(maxDepth = -1): string {
    return DOMTextProcessor.getAllTextTillNextClickableElement(this, maxDepth);
  }

  /**
   * Convert clickable elements to formatted string representation
   */
  clickableElementsToString(includeAttributes: string[] = []): string {
    return DOMTextProcessor.clickableElementsToString(this, includeAttributes);
  }

  /**
   * Get enhanced CSS selector for this element
   */
  getEnhancedCssSelector(): string {
    return DOMSelectorProcessor.getEnhancedCssSelector(this);
  }

  /**
   * Convert XPath to CSS selector
   */
  convertSimpleXPathToCssSelector(xpath: string): string {
    return DOMSelectorProcessor.convertSimpleXPathToCssSelector(xpath);
  }

  /**
   * Generate enhanced CSS selector with dynamic attributes
   */
  enhancedCssSelectorForElement(includeDynamicAttributes = true): string {
    return DOMSelectorProcessor.enhancedCssSelectorForElement(this, includeDynamicAttributes);
  }

  /**
   * Get file upload element
   */
  getFileUploadElement(checkSiblings = true): DOMElementNode | null {
    return DOMSelectorProcessor.getFileUploadElement(this, checkSiblings);
  }

  /**
   * Check if this element is a file uploader by traversing up the tree
   */
  isFileUploader(maxDepth = 3, currentDepth = 0): boolean {
    // Check current element
    if (this.tagName?.toLowerCase() === 'input' && this.attributes.type === 'file') {
      return true;
    }

    // Stop if we've reached max depth
    if (currentDepth >= maxDepth) {
      return false;
    }

    // Check if any children are file uploaders
    for (const child of this.children) {
      if (child instanceof DOMElementNode || child instanceof EnhancedDOMElement) {
        const childElement = child instanceof EnhancedDOMElement ? child : this.upgradeToEnhanced(child);

        if (childElement.isFileUploader(maxDepth, currentDepth + 1)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Build full selector path from root to this element
   */
  buildSelectorPath(): string {
    return DOMSelectorProcessor.buildSelectorPath(this);
  }

  /**
   * Check if this element matches a CSS selector pattern
   */
  matchesSelector(pattern: string): boolean {
    return DOMSelectorProcessor.matchesSelector(this, pattern);
  }

  /**
   * Extract visible text content from this element and its children
   */
  extractVisibleText(): string {
    return DOMTextProcessor.extractVisibleText(this);
  }

  /**
   * Count text nodes in this element's subtree
   */
  countTextNodes(): number {
    return DOMTextProcessor.countTextNodes(this);
  }

  /**
   * Find text nodes containing specific text
   */
  findTextNodes(searchText: string, caseSensitive = false) {
    return DOMTextProcessor.findTextNodes(this, searchText, caseSensitive);
  }

  /**
   * Check if this element is clickable/interactive
   */
  isClickable(): boolean {
    return this.isInteractive || this.highlightIndex !== null;
  }

  /**
   * Check if this element is a form input
   */
  isFormInput(): boolean {
    const inputTags = ['input', 'textarea', 'select', 'button'];
    return inputTags.includes(this.tagName?.toLowerCase() || '');
  }

  /**
   * Get the element's role (for accessibility)
   */
  getRole(): string | null {
    return this.attributes.role || null;
  }

  /**
   * Get the element's aria-label (for accessibility)
   */
  getAriaLabel(): string | null {
    return this.attributes['aria-label'] || null;
  }

  /**
   * Check if element has a specific class
   */
  hasClass(className: string): boolean {
    const classes = this.attributes.class;
    if (!classes) return false;

    return classes.split(/\s+/).includes(className);
  }

  /**
   * Get all class names as an array
   */
  getClasses(): string[] {
    const classes = this.attributes.class;
    if (!classes) return [];

    return classes.split(/\s+/).filter(cls => cls.trim());
  }

  /**
   * Check if element is inside a specific container type
   */
  isInsideContainer(containerTag: string): boolean {
    let current = this.parent;
    while (current) {
      if (current.tagName?.toLowerCase() === containerTag.toLowerCase()) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Get the nearest parent with a specific tag
   */
  findParentByTag(tagName: string): DOMElementNode | null {
    let current = this.parent;
    while (current) {
      if (current.tagName?.toLowerCase() === tagName.toLowerCase()) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  /**
   * Upgrade a regular DOMElementNode to an EnhancedDOMElement
   */
  private upgradeToEnhanced(element: DOMElementNode): EnhancedDOMElement {
    return Object.setPrototypeOf(element, EnhancedDOMElement.prototype) as EnhancedDOMElement;
  }

  /**
   * Create EnhancedDOMElement from DOMElementNode
   */
  static fromDOMElement(element: DOMElementNode): EnhancedDOMElement {
    return Object.setPrototypeOf(element, EnhancedDOMElement.prototype) as EnhancedDOMElement;
  }

  /**
   * Create a new EnhancedDOMElement with the same constructor signature
   */
  static create(params: ConstructorParameters<typeof DOMElementNode>[0]): EnhancedDOMElement {
    return new EnhancedDOMElement(params);
  }
}
