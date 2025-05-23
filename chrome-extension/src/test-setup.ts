/**
 * Test setup for Chrome Extension
 * Configures mocks and global environment for testing
 */

import { vi } from 'vitest';

// Mock Chrome APIs
const chromeMock = {
  runtime: {
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onConnect: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    sendMessage: vi.fn(),
    connect: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
    id: 'test-extension-id',
  },
  tabs: {
    query: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onActivated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onRemoved: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  debugger: {
    attach: vi.fn(),
    detach: vi.fn(),
    sendCommand: vi.fn(),
    onDetach: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onEvent: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  scripting: {
    executeScript: vi.fn(),
  },
  sidePanel: {
    setPanelBehavior: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
  },
};

// Mock webextension-polyfill
vi.mock('webextension-polyfill', () => ({
  default: chromeMock,
}));

// Make chrome globally available
global.chrome = chromeMock as any;

// Mock console methods for structured logger testing
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
  log: vi.fn(),
};

// Mock DOM globals that might be used in tests
Object.defineProperty(window, 'location', {
  value: {
    href: 'https://example.com',
    hostname: 'example.com',
    pathname: '/',
    search: '',
    hash: '',
  },
  writable: true,
});

// Mock fetch for LLM API calls
global.fetch = vi.fn();

// Mock AbortController for cancellation testing
global.AbortController = class MockAbortController {
  signal = {
    aborted: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  abort = vi.fn(() => {
    this.signal.aborted = true;
  });
};

// Export test utilities
export { chromeMock };

export const createMockTab = (overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab => ({
  id: 1,
  url: 'https://example.com',
  title: 'Test Page',
  active: true,
  windowId: 1,
  index: 0,
  highlighted: false,
  incognito: false,
  pinned: false,
  audible: false,
  discarded: false,
  autoDiscardable: true,
  mutedInfo: { muted: false },
  groupId: chrome.tabGroups?.TAB_GROUP_ID_NONE ?? -1,
  status: 'complete',
  ...overrides,
});

export const createMockPort = (): chrome.runtime.Port => ({
  name: 'side-panel-connection',
  disconnect: vi.fn(),
  onDisconnect: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(),
    hasListeners: vi.fn(),
  },
  onMessage: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(),
    hasListeners: vi.fn(),
  },
  postMessage: vi.fn(),
  sender: {
    tab: createMockTab(),
    frameId: 0,
    url: 'chrome-extension://test-id/index.html',
  },
});

export const createMockLLM = () => ({
  modelName: 'test-model',
  invoke: vi.fn(),
  withStructuredOutput: vi.fn(() => ({
    invoke: vi.fn(),
  })),
});

export const createMockBrowserContext = () => ({
  getCurrentPage: vi.fn(),
  getState: vi.fn(),
  switchTab: vi.fn(),
  navigateTo: vi.fn(),
  cleanup: vi.fn(),
  updateConfig: vi.fn(),
  removeHighlight: vi.fn(),
  attachPage: vi.fn(),
  detachPage: vi.fn(),
});
