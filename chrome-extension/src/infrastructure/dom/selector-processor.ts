import { DOMElementNode } from './base-node';

/**
 * CSS Selector processing utilities for DOM elements
 */
export class DOMSelectorProcessor {
  /**
   * Get enhanced CSS selector for an element
   */
  static getEnhancedCssSelector(element: DOMElementNode): string {
    if (!element.xpath) {
      return '';
    }
    return this.convertSimpleXPathToCssSelector(element.xpath);
  }

  /**
   * Convert simple XPath expressions to CSS selectors
   */
  static convertSimpleXPathToCssSelector(xpath: string): string {
    if (!xpath || xpath === '') {
      return '';
    }

    // Handle root case
    if (xpath === '/') {
      return '';
    }

    // Remove leading '/' if present
    let path = xpath.startsWith('/') ? xpath.slice(1) : xpath;

    // Split the path into segments
    const segments = path.split('/');
    const cssSegments: string[] = [];

    for (const segment of segments) {
      if (!segment) continue;

      // Match patterns like "div[1]", "span[2]", etc.
      const indexMatch = segment.match(/^(\w+)\[(\d+)\]$/);
      if (indexMatch) {
        const [, tagName, index] = indexMatch;
        // CSS nth-child is 1-indexed, same as XPath
        cssSegments.push(`${tagName}:nth-child(${index})`);
        continue;
      }

      // Match patterns with attributes like "div[@class='example']"
      const attrMatch = segment.match(/^(\w+)\[@(\w+)=['"]([^'"]*)['"]\]$/);
      if (attrMatch) {
        const [, tagName, attrName, attrValue] = attrMatch;
        if (attrName === 'class') {
          cssSegments.push(`${tagName}.${attrValue.replace(/\s+/g, '.')}`);
        } else if (attrName === 'id') {
          cssSegments.push(`${tagName}#${attrValue}`);
        } else {
          cssSegments.push(`${tagName}[${attrName}="${attrValue}"]`);
        }
        continue;
      }

      // Simple tag names
      if (/^\w+$/.test(segment)) {
        cssSegments.push(segment);
        continue;
      }

      // If we can't convert, return empty string
      return '';
    }

    return cssSegments.join(' > ');
  }

  /**
   * Generate enhanced CSS selector for element with dynamic attributes
   */
  static enhancedCssSelectorForElement(element: DOMElementNode, includeDynamicAttributes = true): string {
    if (!element.tagName) {
      return '';
    }

    let selector = element.tagName.toLowerCase();

    // Add ID if present
    if (element.attributes.id) {
      selector += `#${this.escapeSelector(element.attributes.id)}`;
      return selector; // ID is unique, no need for further specificity
    }

    // Add classes if present
    if (element.attributes.class) {
      const classes = this.getValidCssClasses(element.attributes.class);
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }

    // Add other important attributes
    const importantAttrs = ['name', 'type', 'role', 'data-testid'];
    for (const attr of importantAttrs) {
      if (element.attributes[attr]) {
        selector += `[${attr}="${this.escapeSelector(element.attributes[attr])}"]`;
      }
    }

    // Add dynamic attributes if requested
    if (includeDynamicAttributes) {
      const dynamicAttrs = ['href', 'src', 'alt', 'title', 'placeholder'];
      for (const attr of dynamicAttrs) {
        if (element.attributes[attr]) {
          const value = element.attributes[attr];
          if (value.length < 50) {
            // Only include short values
            selector += `[${attr}="${this.escapeSelector(value)}"]`;
          }
        }
      }
    }

    return selector;
  }

  /**
   * Get valid CSS class names from a class attribute value
   */
  private static getValidCssClasses(classAttr: string): string[] {
    const classes: string[] = [];

    // Define a regex pattern for valid class names in CSS
    const validClassPattern = /^[a-zA-Z_][\w-]*$/;

    // Split and process each class
    const classNames = classAttr.split(/\s+/);

    for (const className of classNames) {
      // Skip empty class names
      if (!className.trim()) {
        continue;
      }

      // Check if the class name is valid
      if (validClassPattern.test(className)) {
        classes.push(this.escapeSelector(className));
      }
    }

    return classes;
  }

  /**
   * Escape special characters in CSS selectors
   */
  private static escapeSelector(value: string): string {
    // Escape special CSS characters
    return value.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
  }

  /**
   * Get file upload element (for forms)
   */
  static getFileUploadElement(element: DOMElementNode, checkSiblings = true): DOMElementNode | null {
    // Check if current element is a file input
    if (element.tagName?.toLowerCase() === 'input' && element.attributes.type === 'file') {
      return element;
    }

    // Check children
    for (const child of element.children) {
      if (child instanceof DOMElementNode) {
        const result = this.getFileUploadElement(child, false);
        if (result) {
          return result;
        }
      }
    }

    // Check siblings if requested
    if (checkSiblings && element.parent) {
      for (const sibling of element.parent.children) {
        if (sibling instanceof DOMElementNode && sibling !== element) {
          const result = this.getFileUploadElement(sibling, false);
          if (result) {
            return result;
          }
        }
      }
    }

    return null;
  }

  /**
   * Build selector path from root to element
   */
  static buildSelectorPath(element: DOMElementNode): string {
    const path: string[] = [];
    let current: DOMElementNode | null = element;

    while (current) {
      const selector = this.enhancedCssSelectorForElement(current, false);
      if (selector) {
        path.unshift(selector);
      }
      current = current.parent;
    }

    return path.join(' > ');
  }

  /**
   * Check if element matches a CSS selector pattern
   */
  static matchesSelector(element: DOMElementNode, pattern: string): boolean {
    const elementSelector = this.enhancedCssSelectorForElement(element);
    return elementSelector.includes(pattern);
  }
}
