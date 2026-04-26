import type { Message } from '../types/session.js';
import type {
  CompressionConfig,
  CompressionResult,
  CompressionStrategyType,
  ICompressionStrategy,
} from '../types/compression.js';
import type { TokenCounter } from '../types/token.js';
import { CompressionError } from '../types/errors.js';
import { calculateMessageTokens, preserveSystemMessages } from './CompressionStrategy.js';

/**
 * Compression strategy that keeps the most recent messages
 * that fit within the token budget. System messages are always preserved.
 *
 * @example
 * ```typescript
 * const strategy = new SlidingWindowStrategy();
 * const result = await strategy.compress(messages, {
 *   strategy: 'sliding_window',
 *   targetTokens: 3500,
 *   minMessages: 5
 * }, tokenizer);
 * ```
 */
export class SlidingWindowStrategy implements ICompressionStrategy {
  readonly type: CompressionStrategyType = 'sliding_window';

  /**
   * Compress messages by sliding a window over the most recent messages.
   *
   * @param messages - All messages in the session
   * @param config - Compression configuration
   * @param tokenCounter - Token counter implementation
   * @returns Compression result with kept and removed messages
   * @throws {CompressionError} If config strategy does not match
   */
  async compress(
    messages: Message[],
    config: CompressionConfig,
    tokenCounter: TokenCounter
  ): Promise<CompressionResult> {
    if (config.strategy !== 'sliding_window') {
      throw new CompressionError('SlidingWindowStrategy requires strategy: sliding_window');
    }

    const originalTokenCount = tokenCounter.countMessages(messages);
    const targetTokens = config.targetTokens;

    const { systemMessages, otherMessages } = preserveSystemMessages(messages);
    const systemTokens = systemMessages.reduce(
      (sum, m) => sum + calculateMessageTokens(m, tokenCounter),
      0
    );

    // Sort non-system by createdAt descending (newest first)
    const sortedOthers = [...otherMessages].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    const kept: Message[] = [];
    let tokenCount = systemTokens;

    for (const message of sortedOthers) {
      const count = calculateMessageTokens(message, tokenCounter);
      if (tokenCount + count <= targetTokens) {
        kept.unshift(message);
        tokenCount += count;
      } else {
        break;
      }
    }

    // Enforce minMessages if specified
    if (config.minMessages !== undefined) {
      const currentNonSystem = kept.filter((m) => m.role !== 'system');
      const needed = config.minMessages - currentNonSystem.length;
      if (needed > 0) {
        const keptIds = new Set(kept.map((m) => m.id));
        const available = sortedOthers.filter((m) => !keptIds.has(m.id)).slice(-needed);
        for (const message of available) {
          kept.unshift(message);
          tokenCount += calculateMessageTokens(message, tokenCounter);
        }
      }
    }

    // Enforce maxMessages if specified
    if (config.maxMessages !== undefined) {
      const nonSystemKept = kept.filter((m) => m.role !== 'system');
      if (nonSystemKept.length > config.maxMessages) {
        const toRemove = nonSystemKept.slice(0, nonSystemKept.length - config.maxMessages);
        const removeSet = new Set(toRemove);
        const newKept = kept.filter((m) => !removeSet.has(m));
        tokenCount = [...systemMessages, ...newKept].reduce(
          (sum, m) => sum + calculateMessageTokens(m, tokenCounter),
          0
        );
        kept.length = 0;
        kept.push(...newKept);
      }
    }

    const compressedMessages = [...systemMessages, ...kept];
    const compressedIds = new Set(compressedMessages.map((m) => m.id));
    const removedMessages = messages.filter((m) => !compressedIds.has(m.id));

    return {
      originalMessages: messages,
      compressedMessages,
      originalTokenCount,
      compressedTokenCount: tokenCount,
      strategy: 'sliding_window',
      removedMessages,
    };
  }
}
