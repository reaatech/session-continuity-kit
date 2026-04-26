import { describe, it, expect, vi } from 'vitest';
import { SummarizationStrategy } from '../src/compression/SummarizationStrategy.js';
import type { Message, SummarizerService } from '../src/types/index.js';
import type { TokenCounter } from '../src/types/token.js';

function createMessage(
  content: string,
  role: Message['role'] = 'user',
  overrides?: Partial<Message>
): Message {
  return {
    id: `msg-${content}`,
    sessionId: 'session-1',
    role,
    content,
    createdAt: new Date(2024, 0, 1),
    ...overrides,
  };
}

const mockTokenCounter: TokenCounter = {
  count: (text: string) => text.length,
  countMessages: (messages: Message[]) =>
    messages.reduce(
      (sum, m) =>
        sum +
        (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length) +
        3,
      0
    ) + 3,
  model: 'mock',
  tokenizer: 'mock',
};

describe('SummarizationStrategy', () => {
  const mockSummarizer: SummarizerService = {
    summarize: vi.fn(async (messages) => `Summary of ${messages.length} messages`),
  };

  it('returns no-op when messages are under budget', async () => {
    const strategy = new SummarizationStrategy(mockSummarizer);
    const messages = [createMessage('hi')];

    const result = await strategy.compress(
      messages,
      {
        strategy: 'summarization',
        targetTokens: 1000,
        summarizer: mockSummarizer,
      },
      mockTokenCounter
    );

    expect(result.compressedMessages).toEqual(messages);
    expect(result.originalTokenCount).toBe(result.compressedTokenCount);
    expect(result.removedMessages).toEqual([]);
    expect(mockSummarizer.summarize).not.toHaveBeenCalled();
  });

  it('throws when given wrong config type', async () => {
    const strategy = new SummarizationStrategy(mockSummarizer);
    await expect(
      strategy.compress(
        [],
        {
          strategy: 'sliding_window',
          targetTokens: 100,
        } as any,
        mockTokenCounter
      )
    ).rejects.toThrow('SummarizationStrategy requires strategy: summarization');
  });

  it('preserves system messages and summarizes old messages', async () => {
    const strategy = new SummarizationStrategy(mockSummarizer);
    const systemMsg = createMessage('You are helpful', 'system', {
      createdAt: new Date(2024, 0, 1),
    });
    const oldMsg = createMessage('A'.repeat(200), 'user', { createdAt: new Date(2024, 0, 2) });
    const recentMsg = createMessage('B'.repeat(10), 'assistant', {
      createdAt: new Date(2024, 0, 3),
    });

    const result = await strategy.compress(
      [systemMsg, oldMsg, recentMsg],
      { strategy: 'summarization', targetTokens: 150, summarizer: mockSummarizer },
      mockTokenCounter
    );

    // System message should be preserved
    expect(result.compressedMessages.some((m) => m.role === 'system')).toBe(true);
    // Recent message should be kept
    expect(result.compressedMessages.some((m) => m.content === 'B'.repeat(10))).toBe(true);
    // A summary message should be present
    expect(
      result.compressedMessages.some(
        (m) => m.role === 'system' && (m.content as string).includes('Summary')
      )
    ).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.removedMessages.length).toBeGreaterThan(0);
  });

  it('handles empty messages', async () => {
    const strategy = new SummarizationStrategy(mockSummarizer);
    const result = await strategy.compress(
      [],
      {
        strategy: 'summarization',
        targetTokens: 100,
        summarizer: mockSummarizer,
      },
      mockTokenCounter
    );

    expect(result.compressedMessages).toEqual([]);
    expect(result.removedMessages).toEqual([]);
  });

  it('includes summarization prompt when provided', async () => {
    const strategy = new SummarizationStrategy(mockSummarizer);
    const messages = [
      createMessage('A'.repeat(100), 'user', { createdAt: new Date(2024, 0, 1) }),
      createMessage('B'.repeat(100), 'user', { createdAt: new Date(2024, 0, 2) }),
    ];

    await strategy.compress(
      messages,
      {
        strategy: 'summarization',
        targetTokens: 50,
        summarizer: mockSummarizer,
        summarizationPrompt: 'Custom prompt',
      },
      mockTokenCounter
    );

    expect(mockSummarizer.summarize).toHaveBeenCalledWith(expect.any(Array), 'Custom prompt');
  });
});
