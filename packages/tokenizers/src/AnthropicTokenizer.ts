import type { TokenCounter } from '@reaatech/session-continuity';
import type { Message } from '@reaatech/session-continuity';
import { createRequire } from 'node:module';
import { extractTextFromContent } from './utils.js';

/**
 * Token counter for Anthropic Claude models.
 * Uses the `@anthropic-ai/tokenizer` package if available.
 *
 * @example
 * ```typescript
 * const tokenizer = new AnthropicTokenizer('claude-3-sonnet');
 * const count = tokenizer.count('Hello, world!');
 * tokenizer.dispose();
 * ```
 */
export class AnthropicTokenizer implements TokenCounter {
  private encoding: { encode(text: string): Uint32Array | number[]; free?(): void } | null = null;
  private modelName: string;

  constructor(model: string = 'claude-3-sonnet') {
    this.modelName = model;
  }

  private getEncoding(): { encode(text: string): Uint32Array | number[]; free?(): void } {
    if (!this.encoding) {
      const require = createRequire(import.meta.url);
      const { getTokenizer } = require('@anthropic-ai/tokenizer');
      this.encoding = getTokenizer();
    }
    return this.encoding!;
  }

  /**
   * Count tokens in a plain string.
   *
   * @param text - Text to tokenize
   * @returns Token count
   */
  count(text: string): number {
    return this.getEncoding().encode(text).length;
  }

  /**
   * Count tokens in an array of messages, including role overhead.
   *
   * @param messages - Messages to count
   * @returns Total token count
   */
  countMessages(messages: Message[]): number {
    let total = 0;

    for (const message of messages) {
      total += 3; // Role overhead
      total += this.count(extractTextFromContent(message.content));

      if (message.metadata?.toolCalls) {
        for (const toolCall of message.metadata.toolCalls) {
          total += this.count(toolCall.name);
          total += this.count(toolCall.arguments);
        }
      }

      if (message.metadata?.toolResults) {
        for (const toolResult of message.metadata.toolResults) {
          total += this.count(toolResult.result);
        }
      }
    }

    return total + 3; // Message list overhead
  }

  /**
   * Release resources held by the encoding if supported.
   */
  dispose(): void {
    this.encoding?.free?.();
    this.encoding = null;
  }

  get model(): string {
    return this.modelName;
  }

  get tokenizer(): string {
    return 'anthropic';
  }
}
