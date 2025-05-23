import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chromeMock, createMockTab, createMockPort } from '../../test-setup';

// Mock all the dependencies
vi.mock('@extension/storage', () => ({
  agentModelStore: {
    getAllAgentModels: vi.fn(),
  },
  AgentNameEnum: {
    Navigator: 'navigator',
    Planner: 'planner',
    Validator: 'validator',
  },
  firewallStore: {
    getFirewall: vi.fn(),
  },
  generalSettingsStore: {
    getSettings: vi.fn(),
  },
  llmProviderStore: {
    getAllProviders: vi.fn(),
  },
}));

vi.mock('../browser/context', () => ({
  default: class MockBrowserContext {
    constructor() {}
    switchTab = vi.fn();
    getCurrentPage = vi.fn();
    getState = vi.fn();
    cleanup = vi.fn();
    updateConfig = vi.fn();
    removeAttachedPage = vi.fn();
  },
}));

vi.mock('../agent/executor', () => ({
  Executor: class MockExecutor {
    constructor() {}
    execute = vi.fn();
    cancel = vi.fn();
    cleanup = vi.fn();
    addFollowUpTask = vi.fn();
    subscribeExecutionEvents = vi.fn();
    clearExecutionEvents = vi.fn();
  },
}));

describe('Background Script', () => {
  let mockPort: chrome.runtime.Port;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPort = createMockPort();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Extension Initialization', () => {
    it('should register side panel behavior on load', async () => {
      // Import the background script (this triggers initialization)
      await import('../index');

      expect(chromeMock.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
        openPanelOnActionClick: true,
      });
    });

    it('should set up debugger event listeners', async () => {
      await import('../index');

      expect(chromeMock.debugger.onDetach.addListener).toHaveBeenCalled();
    });

    it('should set up tab event listeners', async () => {
      await import('../index');

      expect(chromeMock.tabs.onRemoved.addListener).toHaveBeenCalled();
    });
  });

  describe('Port Connection Handling', () => {
    it('should handle side-panel connection', async () => {
      await import('../index');

      // Verify that onConnect listener was added
      expect(chromeMock.runtime.onConnect.addListener).toHaveBeenCalled();

      // Get the onConnect handler
      const onConnectHandler = chromeMock.runtime.onConnect.addListener.mock.calls[0][0];

      // Simulate port connection
      onConnectHandler(mockPort);

      // Verify message listener was added
      expect(mockPort.onMessage.addListener).toHaveBeenCalled();
      expect(mockPort.onDisconnect.addListener).toHaveBeenCalled();
    });

    it('should reject non-side-panel connections', async () => {
      await import('../index');

      const onConnectHandler = chromeMock.runtime.onConnect.addListener.mock.calls[0][0];
      const wrongPort = { ...mockPort, name: 'wrong-connection' };

      // Simulate wrong port connection
      onConnectHandler(wrongPort);

      // Should not add listeners for wrong port
      expect(wrongPort.onMessage?.addListener).toBeUndefined();
    });
  });

  describe('Message Handling', () => {
    let messageHandler: any;

    beforeEach(async () => {
      await import('../index');

      const onConnectHandler = chromeMock.runtime.onConnect.addListener.mock.calls[0][0];
      onConnectHandler(mockPort);

      messageHandler = mockPort.onMessage.addListener.mock.calls[0][0];
    });

    it('should handle heartbeat messages', async () => {
      const message = { type: 'heartbeat' };

      await messageHandler(message);

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: 'heartbeat_ack',
      });
    });

    it('should validate new_task message requirements', async () => {
      // Test missing task
      const messageNoTask = { type: 'new_task', tabId: 1 };
      await messageHandler(messageNoTask);

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: 'error',
        error: 'No task provided',
      });

      // Test missing tabId
      const messageNoTabId = { type: 'new_task', task: 'test task' };
      await messageHandler(messageNoTabId);

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: 'error',
        error: 'No tab ID provided',
      });
    });

    it('should validate follow_up_task message requirements', async () => {
      // Test missing task
      const messageNoTask = { type: 'follow_up_task', tabId: 1 };
      await messageHandler(messageNoTask);

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: 'error',
        error: 'No follow up task provided',
      });

      // Test missing tabId
      const messageNoTabId = { type: 'follow_up_task', task: 'test task' };
      await messageHandler(messageNoTabId);

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: 'error',
        error: 'No tab ID provided',
      });
    });

    it('should handle screenshot messages', async () => {
      const mockPage = {
        takeScreenshot: vi.fn().mockResolvedValue('screenshot-data'),
      };

      // Mock browserContext.switchTab to return mock page
      const BrowserContext = (await import('../browser/context')).default;
      const mockBrowserContext = new BrowserContext({});
      vi.spyOn(mockBrowserContext, 'switchTab').mockResolvedValue(mockPage as any);

      const message = { type: 'screenshot', tabId: 1 };
      await messageHandler(message);

      // Verify screenshot was taken (implementation may vary)
      expect(mockPort.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });

    it('should handle state messages', async () => {
      const message = { type: 'state' };

      await messageHandler(message);

      // Should attempt to get browser state
      expect(mockPort.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: expect.any(String) }));
    });

    it('should handle unknown message types', async () => {
      const message = { type: 'unknown_message' };

      await messageHandler(message);

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: 'error',
        error: 'Unknown message type',
      });
    });
  });

  describe('Error Handling', () => {
    let messageHandler: any;

    beforeEach(async () => {
      await import('../index');

      const onConnectHandler = chromeMock.runtime.onConnect.addListener.mock.calls[0][0];
      onConnectHandler(mockPort);

      messageHandler = mockPort.onMessage.addListener.mock.calls[0][0];
    });

    it('should handle errors in message processing', async () => {
      // Mock an error in message handling
      const BrowserContext = (await import('../browser/context')).default;
      const mockBrowserContext = new BrowserContext({});
      vi.spyOn(mockBrowserContext, 'getState').mockRejectedValue(new Error('Test error'));

      const message = { type: 'state' };
      await messageHandler(message);

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: 'error',
        error: expect.stringContaining('Test error'),
      });
    });
  });

  describe('Debugger Event Handling', () => {
    it('should handle debugger detach events', async () => {
      await import('../index');

      // Verify debugger listener was added
      expect(chromeMock.debugger.onDetach.addListener).toHaveBeenCalled();

      const debuggerHandler = chromeMock.debugger.onDetach.addListener.mock.calls[0][0];

      // Simulate debugger detach
      const source = { tabId: 1 };
      const reason = 'canceled_by_user';

      await debuggerHandler(source, reason);

      // Should handle cleanup (specific implementation depends on current executor state)
    });
  });

  describe('Tab Management', () => {
    it('should handle tab removal events', async () => {
      await import('../index');

      expect(chromeMock.tabs.onRemoved.addListener).toHaveBeenCalled();

      const tabRemovedHandler = chromeMock.tabs.onRemoved.addListener.mock.calls[0][0];

      // Simulate tab removal
      const tabId = 123;
      tabRemovedHandler(tabId);

      // Should call removeAttachedPage (implementation detail)
    });
  });

  describe('Configuration Error Handling', () => {
    it('should handle missing providers configuration', async () => {
      // Mock empty providers
      const { llmProviderStore } = await import('@extension/storage');
      vi.mocked(llmProviderStore.getAllProviders).mockResolvedValue({});

      await import('../index');

      const onConnectHandler = chromeMock.runtime.onConnect.addListener.mock.calls[0][0];
      onConnectHandler(mockPort);

      const messageHandler = mockPort.onMessage.addListener.mock.calls[0][0];

      const message = {
        type: 'new_task',
        task: 'test task',
        taskId: 'test-id',
        tabId: 1,
      };

      await messageHandler(message);

      // Should return configuration error
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: 'error',
        error: expect.stringContaining('configure API keys'),
      });
    });
  });

  describe('Logger Integration', () => {
    it('should use structured logger throughout background script', async () => {
      // This test verifies that the logger import fixes are working

      await import('../index');

      // Background script should initialize without logger errors
      expect(chromeMock.sidePanel.setPanelBehavior).toHaveBeenCalled();

      // Logger should be accessible and not throw errors
      const { createLogger } = await import('../../infrastructure/monitoring/logger');
      const logger = createLogger('BackgroundTest');

      expect(() => {
        logger.info('Test message');
      }).not.toThrow();
    });
  });
});
