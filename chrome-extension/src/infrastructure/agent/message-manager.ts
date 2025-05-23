import { createLogger } from '@src/infrastructure/monitoring/logger';
import { type BaseMessage, AIMessage, HumanMessage, type SystemMessage, ToolMessage } from '@langchain/core/messages';
import { MessageHistory, MessageMetadata } from '@src/background/agent/messages/views';

const logger = createLogger('MessageManagerInfrastructure');

/**
 * Configuration for message manager
 */
export interface MessageManagerConfig {
  maxInputTokens: number;
  estimatedCharactersPerToken: number;
  imageTokens: number;
  includeAttributes: string[];
  messageContext?: string;
  sensitiveData?: Record<string, string>;
  availableFilePaths?: string[];
}

/**
 * Token count information for a message
 */
export interface TokenInfo {
  count: number;
  estimated: boolean;
}

/**
 * Message statistics
 */
export interface MessageStats {
  totalMessages: number;
  totalTokens: number;
  messagesByType: Record<string, number>;
  tokensByType: Record<string, number>;
}

/**
 * Utility class for managing message tokens and content
 */
export class MessageTokenManager {
  private config: MessageManagerConfig;

  constructor(config: MessageManagerConfig) {
    this.config = config;
  }

  /**
   * Count tokens in a message
   */
  countTokens(message: BaseMessage): TokenInfo {
    if (typeof message.content === 'string') {
      return {
        count: this.countTextTokens(message.content),
        estimated: true,
      };
    }

    if (Array.isArray(message.content)) {
      let totalTokens = 0;
      for (const content of message.content) {
        if (content.type === 'text') {
          totalTokens += this.countTextTokens(content.text);
        } else if (content.type === 'image_url') {
          totalTokens += this.config.imageTokens;
        }
      }
      return {
        count: totalTokens,
        estimated: true,
      };
    }

    return { count: 0, estimated: true };
  }

  /**
   * Count tokens in text content
   */
  private countTextTokens(text: string): number {
    return Math.ceil(text.length / this.config.estimatedCharactersPerToken);
  }

  /**
   * Filter sensitive data from message content
   */
  filterSensitiveData(message: BaseMessage): BaseMessage {
    if (!this.config.sensitiveData) {
      return message;
    }

    const replaceSensitive = (value: string): string => {
      let result = value;
      for (const [placeholder, realValue] of Object.entries(this.config.sensitiveData!)) {
        const secretPattern = new RegExp(`<secret>${placeholder}</secret>`, 'g');
        result = result.replace(secretPattern, realValue);
      }
      return result;
    };

    if (typeof message.content === 'string') {
      const newContent = replaceSensitive(message.content);
      return message.constructor.name === 'HumanMessage'
        ? new HumanMessage({ content: newContent })
        : message.constructor.name === 'AIMessage'
          ? new AIMessage({ content: newContent })
          : message;
    }

    return message;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<MessageManagerConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current configuration
   */
  getConfig(): MessageManagerConfig {
    return { ...this.config };
  }
}

/**
 * Message history manager with token tracking
 */
export class MessageHistoryManager {
  private history: MessageHistory;
  private tokenManager: MessageTokenManager;
  private toolIdCounter: number;

  constructor(config: MessageManagerConfig) {
    this.history = new MessageHistory();
    this.tokenManager = new MessageTokenManager(config);
    this.toolIdCounter = 1;
  }

  /**
   * Add message with automatic token counting
   */
  addMessage(message: BaseMessage, messageType?: string | null, position?: number): void {
    const filteredMessage = this.tokenManager.filterSensitiveData(message);
    const tokenInfo = this.tokenManager.countTokens(filteredMessage);

    const metadata = new MessageMetadata(tokenInfo.count, messageType || this.inferMessageType(message));

    if (position !== undefined) {
      this.history.insertMessage(filteredMessage, metadata, position);
    } else {
      this.history.addMessage(filteredMessage, metadata);
    }

    logger.debug('Message added', {
      type: message.constructor.name,
      messageType: metadata.messageType,
      tokens: tokenInfo.count,
      position: position ?? this.history.messages.length - 1,
    });
  }

  /**
   * Add tool message with automatic ID generation
   */
  addToolMessage(content: string, toolCallId?: number, messageType?: string | null): void {
    const id = toolCallId ?? this.getNextToolId();
    const toolMessage = new ToolMessage({
      content,
      tool_call_id: String(id),
    });

    this.addMessage(toolMessage, messageType);
  }

  /**
   * Remove last message of specific type
   */
  removeLastMessage(messageType?: string): BaseMessage | null {
    const messages = this.history.messages;
    const metadata = this.history.metadata;

    for (let i = messages.length - 1; i >= 0; i--) {
      if (!messageType || metadata[i].messageType === messageType) {
        const removedMessage = messages[i];
        this.history.removeMessage(i);

        logger.debug('Message removed', {
          type: removedMessage.constructor.name,
          messageType: metadata[i]?.messageType,
          position: i,
        });

        return removedMessage;
      }
    }

    return null;
  }

  /**
   * Get all messages
   */
  getMessages(): BaseMessage[] {
    return [...this.history.messages];
  }

  /**
   * Get message count
   */
  getMessageCount(): number {
    return this.history.messages.length;
  }

  /**
   * Get next tool ID
   */
  getNextToolId(): number {
    return this.toolIdCounter++;
  }

  /**
   * Cut messages to fit token limit
   */
  cutMessagesToFitTokens(): void {
    const maxTokens = this.tokenManager.getConfig().maxInputTokens;
    let totalTokens = this.getTotalTokens();

    if (totalTokens <= maxTokens) {
      return;
    }

    logger.info('Cutting messages to fit token limit', {
      currentTokens: totalTokens,
      maxTokens,
      messageCount: this.history.messages.length,
    });

    // Keep first few important messages (system, init messages)
    const protectedMessages = 5;
    const messages = this.history.messages;
    const metadata = this.history.metadata;

    // Remove messages from the middle, keeping recent and initial messages
    let removedCount = 0;
    for (let i = protectedMessages; i < messages.length - 10 && totalTokens > maxTokens; i++) {
      totalTokens -= metadata[i].tokens;
      removedCount++;
    }

    if (removedCount > 0) {
      this.history.removeMessages(protectedMessages, removedCount);
      logger.info(`Removed ${removedCount} messages to fit token limit`, {
        newTokenCount: this.getTotalTokens(),
        newMessageCount: this.history.messages.length,
      });
    }
  }

  /**
   * Get message statistics
   */
  getStatistics(): MessageStats {
    const messages = this.history.messages;
    const metadata = this.history.metadata;

    const stats: MessageStats = {
      totalMessages: messages.length,
      totalTokens: this.getTotalTokens(),
      messagesByType: {},
      tokensByType: {},
    };

    for (let i = 0; i < messages.length; i++) {
      const messageType = metadata[i].messageType;
      const tokens = metadata[i].tokens;

      stats.messagesByType[messageType] = (stats.messagesByType[messageType] || 0) + 1;
      stats.tokensByType[messageType] = (stats.tokensByType[messageType] || 0) + tokens;
    }

    return stats;
  }

  /**
   * Get total token count
   */
  private getTotalTokens(): number {
    return this.history.metadata.reduce((total, meta) => total + meta.tokens, 0);
  }

  /**
   * Infer message type from message content
   */
  private inferMessageType(message: BaseMessage): string {
    if (message instanceof HumanMessage) {
      return 'human';
    } else if (message instanceof AIMessage) {
      return 'ai';
    } else if (message instanceof ToolMessage) {
      return 'tool';
    } else {
      return 'system';
    }
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.history = new MessageHistory();
    this.toolIdCounter = 1;
    logger.debug('Message history cleared');
  }

  /**
   * Update token manager configuration
   */
  updateConfig(updates: Partial<MessageManagerConfig>): void {
    this.tokenManager.updateConfig(updates);
  }
}
