import type { Message } from '../types/session.js';
import type { MessageWindowConfig } from '../types/config.js';
import type { TokenCounter, TokenCountResult } from '../types/token.js';
import {
  calculateMessageTokens,
  preserveSystemMessages,
} from '../compression/CompressionStrategy.js';

export class MessageWindow {
  constructor(
    private config: MessageWindowConfig,
    private tokenCounter: TokenCounter
  ) {}

  /**
   * Get messages that fit within the token budget.
   * Always preserves system messages. Removes oldest non-system messages first.
   */
  getFittedMessages(messages: Message[]): Message[] {
    const { maxTokens, reserveTokens } = this.config.tokenBudget;
    const availableTokens = maxTokens - reserveTokens;

    const { systemMessages, otherMessages } = preserveSystemMessages(messages);
    const systemTokens = systemMessages.reduce(
      (sum, m) => sum + calculateMessageTokens(m, this.tokenCounter),
      0
    );

    // Sort non-system by createdAt descending (newest first)
    const sortedOthers = [...otherMessages].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    const fitted: Message[] = [];
    let currentTokens = systemTokens;

    for (const message of sortedOthers) {
      const tokenCount = calculateMessageTokens(message, this.tokenCounter);
      if (currentTokens + tokenCount <= availableTokens) {
        fitted.unshift(message); // prepend to maintain chronological order
        currentTokens += tokenCount;
      } else {
        break;
      }
    }

    return [...systemMessages, ...fitted];
  }

  /**
   * Calculate current token usage for a set of messages.
   */
  getTokenUsage(messages: Message[]): TokenCountResult {
    const { maxTokens, reserveTokens } = this.config.tokenBudget;

    const systemMessages = messages.filter((m) => m.role === 'system');
    const systemTokens = systemMessages.reduce(
      (sum, m) => sum + calculateMessageTokens(m, this.tokenCounter),
      0
    );

    const messageTokens = messages.reduce(
      (sum, m) => sum + calculateMessageTokens(m, this.tokenCounter),
      0
    );

    const availableTokens = Math.max(0, maxTokens - reserveTokens - messageTokens);
    const overageTokens = Math.max(0, messageTokens - (maxTokens - reserveTokens));

    return {
      totalTokens: messageTokens,
      messageTokens: messageTokens - systemTokens,
      systemTokens,
      availableTokens,
      isOverBudget: messageTokens > maxTokens - reserveTokens,
      overageTokens,
    };
  }
}
