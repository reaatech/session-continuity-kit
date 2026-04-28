import type { Message } from '../types/session.js';
import type {
  CompressionConfig,
  CompressionResult,
  CompressionStrategyType,
  ICompressionStrategy,
  SummarizerService,
} from '../types/compression.js';
import type { TokenCounter } from '../types/token.js';
import { randomUUID } from 'node:crypto';
import { CompressionError } from '../types/errors.js';
import { calculateMessageTokens, preserveSystemMessages } from './CompressionStrategy.js';

/**
 * Compression strategy that summarizes older messages using an LLM,
 * keeping recent messages intact.
 *
 * @example
 * ```typescript
 * const strategy = new SummarizationStrategy(new OpenAISummarizer());
 * const result = await strategy.compress(messages, {
 *   strategy: 'summarization',
 *   targetTokens: 3500,
 *   summarizer: mySummarizerService
 * }, tokenizer);
 * ```
 */
export class SummarizationStrategy implements ICompressionStrategy {
  readonly type: CompressionStrategyType = 'summarization';

  constructor(private summarizer: SummarizerService) {}

  /**
   * Compress messages by summarizing older ones and keeping recent messages.
   *
   * @param messages - All messages in the session
   * @param config - Compression configuration
   * @param tokenCounter - Token counter implementation
   * @returns Compression result with summary and kept messages
   * @throws {CompressionError} If config strategy does not match
   */
  async compress(
    messages: Message[],
    config: CompressionConfig,
    tokenCounter: TokenCounter
  ): Promise<CompressionResult> {
    if (config.strategy !== 'summarization') {
      throw new CompressionError('SummarizationStrategy requires strategy: summarization');
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
        strategy: 'summarization',
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
        strategy: 'summarization',
        removedMessages: [],
      };
    }

    const { systemMessages, otherMessages } = preserveSystemMessages(messages);
    const systemTokens = systemMessages.reduce(
      (sum, m) => sum + calculateMessageTokens(m, tokenCounter),
      0
    );

    // Sort non-system by createdAt ascending (oldest first)
    const sortedOthers = [...otherMessages].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    // Determine how many recent messages to keep
    // We need to leave room for summary + system messages
    const summaryOverhead = config.summaryOverhead ?? 50;
    const availableForRecent = targetTokens - systemTokens - summaryOverhead;

    const toKeep: Message[] = [];
    let recentTokens = 0;

    // Keep newest messages first (iterate in reverse)
    for (let i = sortedOthers.length - 1; i >= 0; i--) {
      const message = sortedOthers[i];
      const count = calculateMessageTokens(message, tokenCounter);
      if (recentTokens + count <= availableForRecent) {
        toKeep.unshift(message);
        recentTokens += count;
      } else {
        break;
      }
    }

    const keepIds = new Set(toKeep.map((m) => m.id));
    const toSummarize = sortedOthers.filter((m) => !keepIds.has(m.id));

    let summary: string | undefined;
    if (toSummarize.length > 0) {
      summary = await this.summarizer.summarize(toSummarize, config.summarizationPrompt);
    }

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

    const compressedMessages = summaryMessage
      ? [...systemMessages, summaryMessage, ...toKeep]
      : [...systemMessages, ...toKeep];

    const compressedTokenCount = tokenCounter.countMessages(compressedMessages);

    return {
      originalMessages: messages,
      compressedMessages,
      originalTokenCount,
      compressedTokenCount,
      strategy: 'summarization',
      summary,
      removedMessages: toSummarize,
    };
  }
}
