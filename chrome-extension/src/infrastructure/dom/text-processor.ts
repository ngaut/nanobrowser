import { DOMBaseNode, DOMElementNode, DOMTextNode } from './base-node';

/**
 * Text processing utilities for DOM elements
 */
export class DOMTextProcessor {
  /**
   * Get all text content until the next clickable element
   */
  static getAllTextTillNextClickableElement(element: DOMElementNode, maxDepth = -1): string {
    const textParts: string[] = [];

    const collectText = (node: DOMBaseNode, currentDepth: number): void => {
      if (maxDepth !== -1 && currentDepth > maxDepth) {
        return;
      }

      // Skip this branch if we hit a highlighted element (except for the current node)
      if (node instanceof DOMElementNode && node !== element && node.highlightIndex !== null) {
        return;
      }

      if (node instanceof DOMTextNode) {
        textParts.push(node.text);
      } else if (node instanceof DOMElementNode) {
        for (const child of node.children) {
          collectText(child, currentDepth + 1);
        }
      }
    };

    collectText(element, 0);
    return textParts.join('\n').trim();
  }

  /**
   * Convert clickable elements to formatted string representation
   */
  static clickableElementsToString(element: DOMElementNode, includeAttributes: string[] = []): string {
    const formattedText: string[] = [];

    const processNode = (node: DOMBaseNode, depth: number): void => {
      let nextDepth = depth;
      const depthStr = '\t'.repeat(depth);

      if (node instanceof DOMElementNode) {
        // Add element with highlight_index
        if (node.highlightIndex !== null) {
          let elementStr = `${depthStr}[${node.highlightIndex}] ${node.tagName}`;

          // Add specified attributes
          for (const attr of includeAttributes) {
            if (node.attributes[attr]) {
              elementStr += ` ${attr}="${node.attributes[attr]}"`;
            }
          }

          formattedText.push(elementStr);
          nextDepth = depth + 1;
        }

        // Process children
        for (const child of node.children) {
          processNode(child, nextDepth);
        }
      } else if (node instanceof DOMTextNode && node.text.trim()) {
        formattedText.push(`${depthStr}${node.text.trim()}`);
      }
    };

    processNode(element, 0);
    return formattedText.join('\n');
  }

  /**
   * Extract visible text content from a DOM tree
   */
  static extractVisibleText(node: DOMBaseNode): string {
    const textParts: string[] = [];

    const collectVisibleText = (currentNode: DOMBaseNode): void => {
      if (!currentNode.isVisible) {
        return;
      }

      if (currentNode instanceof DOMTextNode) {
        const trimmedText = currentNode.text.trim();
        if (trimmedText) {
          textParts.push(trimmedText);
        }
      } else if (currentNode instanceof DOMElementNode) {
        for (const child of currentNode.children) {
          collectVisibleText(child);
        }
      }
    };

    collectVisibleText(node);
    return textParts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Count text nodes in a DOM tree
   */
  static countTextNodes(node: DOMBaseNode): number {
    let count = 0;

    const countNodes = (currentNode: DOMBaseNode): void => {
      if (currentNode instanceof DOMTextNode) {
        count++;
      } else if (currentNode instanceof DOMElementNode) {
        for (const child of currentNode.children) {
          countNodes(child);
        }
      }
    };

    countNodes(node);
    return count;
  }

  /**
   * Find text nodes containing specific text
   */
  static findTextNodes(node: DOMBaseNode, searchText: string, caseSensitive = false): DOMTextNode[] {
    const foundNodes: DOMTextNode[] = [];
    const searchStr = caseSensitive ? searchText : searchText.toLowerCase();

    const searchNodes = (currentNode: DOMBaseNode): void => {
      if (currentNode instanceof DOMTextNode) {
        const nodeText = caseSensitive ? currentNode.text : currentNode.text.toLowerCase();
        if (nodeText.includes(searchStr)) {
          foundNodes.push(currentNode);
        }
      } else if (currentNode instanceof DOMElementNode) {
        for (const child of currentNode.children) {
          searchNodes(child);
        }
      }
    };

    searchNodes(node);
    return foundNodes;
  }
}
