import type { TokenCounter } from '@reaatech/session-continuity';
import type { Message } from '@reaatech/session-continuity';
import { extractTextFromContent } from './utils.js';

/**
 * Fast token estimation using a simple characters-per-token ratio.
 * Useful when exact token counting is not required.
 *
 * @example
 * ```typescript
 * const tokenizer = new EstimateTokenizer(4); // ~4 chars per token
 * const count = tokenizer.count('Hello, world!');
 * ```
 */
export class EstimateTokenizer implements TokenCounter {
  private readonly charsPerToken: number;

  constructor(charsPerToken: number = 4) {
    if (charsPerToken <= 0) {
      throw new Error('charsPerToken must be greater than 0');
    }
    this.charsPerToken = charsPerToken;
  }

  /**
   * Estimate token count for a plain string.
   *
   * @param text - Text to estimate
   * @returns Estimated token count
   */
  count(text: string): number {
    return Math.ceil(text.length / this.charsPerToken);
  }

  /**
   * Estimate token count for an array of messages.
   *
   * @param messages - Messages to estimate
   * @returns Estimated total token count
   */
  countMessages(messages: Message[]): number {
    const totalChars = messages.reduce((sum, m) => {
      return sum + extractTextFromContent(m.content).length;
    }, 0);

    let count = Math.ceil(totalChars / this.charsPerToken) + messages.length * 3;

    // Account for tool calls
    for (const message of messages) {
      if (message.metadata?.toolCalls) {
        for (const toolCall of message.metadata.toolCalls) {
          count += this.count(toolCall.name);
          count += this.count(toolCall.arguments);
        }
      }
      if (message.metadata?.toolResults) {
        for (const toolResult of message.metadata.toolResults) {
          count += this.count(toolResult.result);
        }
      }
    }

    return count + 3; // Message list overhead
  }

  get model(): string {
    return 'estimate';
  }

  /**
   * No-op disposal for API consistency.
   */
  dispose(): void {
    // Nothing to release
  }

  get tokenizer(): string {
    return 'estimate';
  }
}
