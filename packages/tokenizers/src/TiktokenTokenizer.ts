import type { TokenCounter } from '@session-continuity-kit/core';
import type { Message } from '@session-continuity-kit/core';
import { extractTextFromContent } from './utils.js';
import { get_encoding, type Tiktoken, type TiktokenEncoding } from '@dqbd/tiktoken';

const MODEL_TO_ENCODING: Record<string, TiktokenEncoding> = {
  'gpt-4': 'cl100k_base',
  'gpt-4-turbo': 'cl100k_base',
  'gpt-4-32k': 'cl100k_base',
  'gpt-4o': 'o200k_base',
  'gpt-4o-mini': 'o200k_base',
  'gpt-3.5-turbo': 'cl100k_base',
  'text-davinci-003': 'p50k_base',
  'text-embedding-ada-002': 'cl100k_base',
  'text-embedding-3-small': 'cl100k_base',
  'text-embedding-3-large': 'cl100k_base',
};

/**
 * Token counter using tiktoken for OpenAI models.
 * Supports GPT-4, GPT-4o, GPT-3.5-turbo, and embedding models.
 *
 * @example
 * ```typescript
 * const tokenizer = new TiktokenTokenizer('gpt-4');
 * const count = tokenizer.count('Hello, world!');
 * const messageCount = tokenizer.countMessages(messages);
 * tokenizer.dispose(); // Release WASM resources
 * ```
 */
export class TiktokenTokenizer implements TokenCounter {
  private encoding: Tiktoken;
  private modelName: string;

  constructor(model: string = 'gpt-4') {
    const encodingName = MODEL_TO_ENCODING[model] ?? 'cl100k_base';
    this.encoding = get_encoding(encodingName);
    this.modelName = model;
  }

  /**
   * Count tokens in a plain string.
   *
   * @param text - Text to tokenize
   * @returns Token count
   */
  count(text: string): number {
    return this.encoding.encode(text).length;
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
   * Release WASM resources held by the encoding.
   * Call this when the tokenizer is no longer needed.
   */
  dispose(): void {
    this.encoding.free();
  }

  get model(): string {
    return this.modelName;
  }

  get tokenizer(): string {
    return 'tiktoken';
  }
}
