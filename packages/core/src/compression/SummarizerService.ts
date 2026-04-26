import type { Message, SummarizerService } from '../types/index.js';

export { SummarizerService };

/**
 * Mock implementation of {@link SummarizerService} for testing.
 * Generates a simple summary from message contents.
 *
 * @example
 * ```typescript
 * const summarizer = new MockSummarizerService();
 * const summary = await summarizer.summarize(messages);
 * ```
 */
export class MockSummarizerService implements SummarizerService {
  /**
   * Summarize a list of messages into a short string.
   *
   * @param messages - Messages to summarize
   * @param prompt - Optional custom prompt
   * @returns Generated summary
   */
  async summarize(messages: Message[], prompt?: string): Promise<string> {
    const topics = messages
      .map((m) => (typeof m.content === 'string' ? m.content : '[multi-modal content]'))
      .join(' ')
      .split(' ')
      .slice(0, 10)
      .join(' ');
    return `Summary of ${messages.length} messages covering: ${topics}${prompt ? ` (prompt: ${prompt})` : ''}`;
  }
}
