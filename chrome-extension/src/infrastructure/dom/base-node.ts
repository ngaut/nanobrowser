import type { CoordinateSet, HashedDomElement, ViewportInfo } from '@src/background/dom/history/view';
import { createLogger } from '@src/infrastructure/monitoring/logger';

const logger = createLogger('DOMNode');

/**
 * Abstract base class for all DOM nodes
 */
export abstract class DOMBaseNode {
  isVisible: boolean;
  parent: DOMElementNode | null;

  constructor(isVisible: boolean, parent?: DOMElementNode | null) {
    this.isVisible = isVisible;
    this.parent = parent ?? null;
  }

  /**
   * Get the type of the node
   */
  abstract get type(): string;
}

/**
 * Text node in the DOM tree
 */
export class DOMTextNode extends DOMBaseNode {
  readonly type = 'TEXT_NODE' as const;
  text: string;

  constructor(text: string, isVisible: boolean, parent?: DOMElementNode | null) {
    super(isVisible, parent);
    this.text = text;
  }

  /**
   * Check if any parent has a highlight index
   */
  hasParentWithHighlightIndex(): boolean {
    let current = this.parent;
    while (current != null) {
      if (current.highlightIndex !== null) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Check if parent is in viewport
   */
  isParentInViewport(): boolean {
    return this.parent?.isInViewport ?? false;
  }

  /**
   * Check if parent is a top element
   */
  isParentTopElement(): boolean {
    return this.parent?.isTopElement ?? false;
  }
}

/**
 * Element node in the DOM tree with all properties and functionality
 */
export class DOMElementNode extends DOMBaseNode {
  readonly type = 'ELEMENT_NODE' as const;

  // Core properties
  tagName: string | null;
  xpath: string | null;
  attributes: Record<string, string>;
  children: DOMBaseNode[];

  // State properties
  isInteractive: boolean;
  isTopElement: boolean;
  isInViewport: boolean;
  shadowRoot: boolean;
  highlightIndex: number | null;

  // Coordinate properties
  viewportCoordinates?: CoordinateSet;
  pageCoordinates?: CoordinateSet;
  viewportInfo?: ViewportInfo;

  // Dynamic state
  isNew: boolean | null;

  // Hash caching
  private _hashedValue?: HashedDomElement;
  private _hashPromise?: Promise<HashedDomElement>;

  constructor(params: {
    tagName: string | null;
    xpath: string | null;
    attributes: Record<string, string>;
    children: DOMBaseNode[];
    isVisible: boolean;
    isInteractive?: boolean;
    isTopElement?: boolean;
    isInViewport?: boolean;
    shadowRoot?: boolean;
    highlightIndex?: number | null;
    viewportCoordinates?: CoordinateSet;
    pageCoordinates?: CoordinateSet;
    viewportInfo?: ViewportInfo;
    isNew?: boolean | null;
    parent?: DOMElementNode | null;
  }) {
    super(params.isVisible, params.parent);
    this.tagName = params.tagName;
    this.xpath = params.xpath;
    this.attributes = params.attributes;
    this.children = params.children;
    this.isInteractive = params.isInteractive ?? false;
    this.isTopElement = params.isTopElement ?? false;
    this.isInViewport = params.isInViewport ?? false;
    this.shadowRoot = params.shadowRoot ?? false;
    this.highlightIndex = params.highlightIndex ?? null;
    this.viewportCoordinates = params.viewportCoordinates;
    this.pageCoordinates = params.pageCoordinates;
    this.viewportInfo = params.viewportInfo;
    this.isNew = params.isNew ?? null;
  }

  /**
   * Returns a hashed representation of this DOM element with caching
   */
  async hash(): Promise<HashedDomElement> {
    if (this._hashedValue) {
      return this._hashedValue;
    }

    if (!this._hashPromise) {
      // Dynamic import to avoid circular dependencies
      this._hashPromise = import('@src/background/dom/history/service')
        .then(({ HistoryTreeProcessor }) => HistoryTreeProcessor.hashDomElement(this))
        .then((result: HashedDomElement) => {
          this._hashedValue = result;
          this._hashPromise = undefined;
          return result;
        })
        .catch((error: Error) => {
          this._hashPromise = undefined;
          logger.error('Error computing DOM element hash', error, {
            tagName: this.tagName,
            highlightIndex: this.highlightIndex,
          });

          const enhancedError = new Error(
            `Failed to hash DOM element (${this.tagName || 'unknown'}): ${error.message}`,
          );

          if (error.stack) {
            enhancedError.stack = error.stack;
          }

          throw enhancedError;
        });
    }

    return this._hashPromise;
  }

  /**
   * Clears the cached hash value, forcing recalculation on next hash() call
   */
  clearHashCache(): void {
    this._hashedValue = undefined;
    this._hashPromise = undefined;
  }
}

/**
 * Interface for DOM state containing the element tree and selector map
 */
export interface DOMState {
  elementTree: DOMElementNode;
  selectorMap: Map<number, DOMElementNode>;
}
