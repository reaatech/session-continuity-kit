import { describe, it, expect, vi } from 'vitest';
import { HybridStrategy } from '../src/compression/HybridStrategy.js';
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

describe('HybridStrategy', () => {
  const mockSummarizer: SummarizerService = {
    summarize: vi.fn(async (messages) => `Summary of ${messages.length} messages`),
  };

  it('returns no-op when messages are under budget', async () => {
    const strategy = new HybridStrategy(mockSummarizer);
    const messages = [createMessage('hi')];

    const result = await strategy.compress(
      messages,
      {
        strategy: 'hybrid',
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
    const strategy = new HybridStrategy(mockSummarizer);
    await expect(
      strategy.compress(
        [],
        {
          strategy: 'sliding_window',
          targetTokens: 100,
        } as any,
        mockTokenCounter
      )
    ).rejects.toThrow('HybridStrategy requires strategy: hybrid');
  });

  it('keeps recent messages and summarizes older ones', async () => {
    const strategy = new HybridStrategy(mockSummarizer);
    const systemMsg = createMessage('You are helpful', 'system', {
      createdAt: new Date(2024, 0, 1),
    });
    const oldMsg1 = createMessage('A'.repeat(50), 'user', { createdAt: new Date(2024, 0, 2) });
    const oldMsg2 = createMessage('B'.repeat(50), 'user', { createdAt: new Date(2024, 0, 3) });
    const recentMsg = createMessage('C'.repeat(10), 'assistant', {
      createdAt: new Date(2024, 0, 4),
    });

    const result = await strategy.compress(
      [systemMsg, oldMsg1, oldMsg2, recentMsg],
      { strategy: 'hybrid', targetTokens: 80, maxMessages: 2, summarizer: mockSummarizer },
      mockTokenCounter
    );

    // System message should be preserved
    expect(
      result.compressedMessages.some((m) => m.role === 'system' && m.content === 'You are helpful')
    ).toBe(true);
    // Recent message should be kept
    expect(result.compressedMessages.some((m) => m.content === 'C'.repeat(10))).toBe(true);
    // Summary message should be present
    expect(
      result.compressedMessages.some(
        (m) => m.role === 'system' && (m.content as string).includes('Summary')
      )
    ).toBe(true);
    expect(result.summary).toBeDefined();
  });

  it('falls back to sliding window when still over budget', async () => {
    const strategy = new HybridStrategy(mockSummarizer);
    const summarizer: SummarizerService = {
      summarize: vi.fn(async () => 'X'.repeat(500)),
    };

    const messages = Array.from({ length: 5 }, (_, i) =>
      createMessage('A'.repeat(100), 'user', { createdAt: new Date(2024, 0, i + 1) })
    );

    const result = await strategy.compress(
      messages,
      { strategy: 'hybrid', targetTokens: 50, maxMessages: 2, summarizer },
      mockTokenCounter
    );

    // Should have compressed to fit within budget
    expect(result.compressedTokenCount).toBeLessThanOrEqual(result.originalTokenCount);
    expect(result.compressedTokenCount).toBeLessThanOrEqual(50);
    expect(result.strategy).toBe('hybrid');
  });

  it('handles empty messages', async () => {
    const strategy = new HybridStrategy(mockSummarizer);
    const result = await strategy.compress(
      [],
      {
        strategy: 'hybrid',
        targetTokens: 100,
        summarizer: mockSummarizer,
      },
      mockTokenCounter
    );

    expect(result.compressedMessages).toEqual([]);
    expect(result.removedMessages).toEqual([]);
  });

  it('does not generate summary when all messages are recent', async () => {
    const strategy = new HybridStrategy(mockSummarizer);
    const messages = [
      createMessage('A'.repeat(10), 'user', { createdAt: new Date(2024, 0, 1) }),
      createMessage('B'.repeat(10), 'assistant', { createdAt: new Date(2024, 0, 2) }),
    ];

    const result = await strategy.compress(
      messages,
      { strategy: 'hybrid', targetTokens: 50, maxMessages: 5, summarizer: mockSummarizer },
      mockTokenCounter
    );

    expect(result.summary).toBeUndefined();
    expect(result.compressedMessages).toHaveLength(2);
  });

  it('passes summarization prompt to summarizer', async () => {
    const strategy = new HybridStrategy(mockSummarizer);
    const messages = [
      createMessage('A'.repeat(100), 'user', { createdAt: new Date(2024, 0, 1) }),
      createMessage('B'.repeat(10), 'assistant', { createdAt: new Date(2024, 0, 2) }),
    ];

    await strategy.compress(
      messages,
      {
        strategy: 'hybrid',
        targetTokens: 50,
        maxMessages: 1,
        summarizer: mockSummarizer,
        summarizationPrompt: 'Custom prompt',
      },
      mockTokenCounter
    );

    expect(mockSummarizer.summarize).toHaveBeenCalledWith(expect.any(Array), 'Custom prompt');
  });
});
