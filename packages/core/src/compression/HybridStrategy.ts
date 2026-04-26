import type { Message } from '../types/session.js';
import type {
  CompressionConfig,
  CompressionResult,
  CompressionStrategyType,
  ICompressionStrategy,
  SummarizerService,
} from '../types/compression.js';
import type { TokenCounter } from '../types/token.js';
import { randomUUID } from 'crypto';
import { CompressionError } from '../types/errors.js';
import { preserveSystemMessages } from './CompressionStrategy.js';
import { SlidingWindowStrategy } from './SlidingWindowStrategy.js';

/**
 * Compression strategy that combines summarization for older messages
 * with a sliding window for recent messages. Falls back to sliding window
 * if the combined result still exceeds the token budget.
 *
 * @example
 * ```typescript
 * const strategy = new HybridStrategy(new OpenAISummarizer());
 * const result = await strategy.compress(messages, {
 *   strategy: 'hybrid',
 *   targetTokens: 3500,
 *   maxMessages: 20
 * }, tokenizer);
 * ```
 */
export class HybridStrategy implements ICompressionStrategy {
  readonly type: CompressionStrategyType = 'hybrid';

  constructor(
    private summarizer: SummarizerService,
    private fallbackStrategy: ICompressionStrategy = new SlidingWindowStrategy()
  ) {}

  /**
   * Compress messages by keeping recent messages and summarizing older ones.
   * Falls back to the fallback strategy if still over budget.
   *
   * @param messages - All messages in the session
   * @param config - Compression configuration
   * @param tokenCounter - Token counter implementation
   * @returns Compression result
   * @throws {CompressionError} If config strategy does not match
   */
  async compress(
    messages: Message[],
    config: CompressionConfig,
    tokenCounter: TokenCounter
  ): Promise<CompressionResult> {
    if (config.strategy !== 'hybrid') {
      throw new CompressionError('HybridStrategy requires strategy: hybrid');
    }

    const originalTokenCount = tokenCounter.countMessages(messages);
    const targetTokens = config.targetTokens;

    // No-op for empty messages
    if (messages.length === 0) {
      return {
        originalMessages: messages,
        compressedMessages: messages,
        originalTokenCount,
        compressedTokenCount: originalTokenCount,
        strategy: 'hybrid',
        removedMessages: [],
      };
    }

    // If already under budget, no-op
    if (originalTokenCount <= targetTokens) {
      return {
        originalMessages: messages,
        compressedMessages: messages,
        originalTokenCount,
        compressedTokenCount: originalTokenCount,
        strategy: 'hybrid',
        removedMessages: [],
      };
    }

    const { systemMessages, otherMessages } = preserveSystemMessages(messages);

    // Get recent messages to keep as-is
    const maxMessages = config.maxMessages ?? 20;
    const recentMessages = [...otherMessages]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, maxMessages)
      .reverse(); // Restore chronological order

    // Messages to summarize
    const recentIds = new Set(recentMessages.map((m) => m.id));
    const toSummarize = otherMessages.filter((m) => !recentIds.has(m.id));

    // Generate summary
    let summary: string | undefined;
    if (toSummarize.length > 0) {
      summary = await this.summarizer.summarize(toSummarize, config.summarizationPrompt);
    }

    // Build compressed message set
    const summaryMessage: Message | undefined = summary
      ? {
          id: randomUUID(),
          sessionId: messages[0]?.sessionId ?? '',
          role: 'system',
          content: `Previous conversation summary: ${summary}`,
          createdAt: new Date(),
          tokenCount: tokenCounter.count(summary),
        }
      : undefined;

    let compressedMessages = [
      ...systemMessages,
      ...(summaryMessage ? [summaryMessage] : []),
      ...recentMessages,
    ];

    let compressedTokenCount = tokenCounter.countMessages(compressedMessages);

    // If still over budget, fall back to sliding window
    if (compressedTokenCount > targetTokens) {
      const fallbackResult = await this.fallbackStrategy.compress(
        compressedMessages,
        { strategy: 'sliding_window', targetTokens, maxMessages },
        tokenCounter
      );
      compressedMessages = fallbackResult.compressedMessages;
      compressedTokenCount = fallbackResult.compressedTokenCount;
    }

    const keptSet = new Set(compressedMessages.map((m) => m.id));
    const removedMessages = messages.filter((m) => !keptSet.has(m.id));

    return {
      originalMessages: messages,
      compressedMessages,
      originalTokenCount,
      compressedTokenCount,
      strategy: 'hybrid',
      summary,
      removedMessages,
    };
  }
}
