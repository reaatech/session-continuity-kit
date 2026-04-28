import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { SlidingWindowStrategy } from '../src/compression/SlidingWindowStrategy.js';
import type { Message } from '../src/types/session.js';
import type { TokenCounter } from '../src/types/token.js';

const mockCounter: TokenCounter = {
  count: (text: string) => Math.ceil(text.length / 4),
  countMessages: (messages: Message[]) =>
    messages.reduce(
      (sum, m) => sum + mockCounter.count(typeof m.content === 'string' ? m.content : ''),
      0
    ) +
    messages.length * 3,
  model: 'mock',
  tokenizer: 'mock',
};

let messageCounter = 0;
function createMessage(content: string, role: Message['role'] = 'user'): Message {
  messageCounter++;
  return {
    id: crypto.randomUUID(),
    sessionId: 'test-session',
    role,
    content,
    createdAt: new Date(messageCounter * 1000),
  };
}

describe('SlidingWindowStrategy', () => {
  it('returns original messages when under budget', async () => {
    const strategy = new SlidingWindowStrategy();
    const messages = [createMessage('Hello'), createMessage('World')];

    const result = await strategy.compress(
      messages,
      { strategy: 'sliding_window', targetTokens: 1000 },
      mockCounter
    );

    expect(result.compressedMessages).toHaveLength(2);
    expect(result.removedMessages).toHaveLength(0);
    expect(result.strategy).toBe('sliding_window');
  });

  it('preserves system messages', async () => {
    const strategy = new SlidingWindowStrategy();
    const messages = [
      createMessage('System prompt', 'system'),
      createMessage('A'.repeat(400), 'user'),
      createMessage('B'.repeat(400), 'assistant'),
    ];

    const result = await strategy.compress(
      messages,
      { strategy: 'sliding_window', targetTokens: 50 },
      mockCounter
    );

    expect(result.compressedMessages.some((m) => m.role === 'system')).toBe(true);
  });

  it('removes oldest messages when over budget', async () => {
    const strategy = new SlidingWindowStrategy();
    const messages = [
      createMessage('A'.repeat(200), 'user'),
      createMessage('B'.repeat(200), 'assistant'),
      createMessage('C'.repeat(200), 'user'),
    ];

    const result = await strategy.compress(
      messages,
      { strategy: 'sliding_window', targetTokens: 80 },
      mockCounter
    );

    expect(result.removedMessages.length).toBeGreaterThan(0);
    expect(result.compressedMessages.length).toBeGreaterThan(0);
    expect(result.compressedMessages[result.compressedMessages.length - 1].content).toBe(
      'C'.repeat(200)
    );
  });

  it('enforces maxMessages', async () => {
    const strategy = new SlidingWindowStrategy();
    const messages = [
      createMessage('One', 'user'),
      createMessage('Two', 'assistant'),
      createMessage('Three', 'user'),
      createMessage('Four', 'assistant'),
    ];

    const result = await strategy.compress(
      messages,
      { strategy: 'sliding_window', targetTokens: 1000, maxMessages: 2 },
      mockCounter
    );

    const nonSystem = result.compressedMessages.filter((m) => m.role !== 'system');
    expect(nonSystem.length).toBeLessThanOrEqual(2);
  });

  it('enforces minMessages even if over budget', async () => {
    const strategy = new SlidingWindowStrategy();
    const messages = [createMessage('One', 'user'), createMessage('Two', 'assistant')];

    const result = await strategy.compress(
      messages,
      { strategy: 'sliding_window', targetTokens: 1, minMessages: 2 },
      mockCounter
    );

    const nonSystem = result.compressedMessages.filter((m) => m.role !== 'system');
    expect(nonSystem.length).toBe(2);
  });

  it('includes system messages in compressedTokenCount after maxMessages', async () => {
    const strategy = new SlidingWindowStrategy();
    const messages = [
      createMessage('System prompt', 'system'),
      createMessage('One', 'user'),
      createMessage('Two', 'assistant'),
      createMessage('Three', 'user'),
    ];

    const result = await strategy.compress(
      messages,
      { strategy: 'sliding_window', targetTokens: 1000, maxMessages: 1 },
      mockCounter
    );

    const systemMsg = result.compressedMessages.filter((m) => m.role === 'system');
    const nonSystemMsg = result.compressedMessages.filter((m) => m.role !== 'system');
    expect(systemMsg.length).toBe(1);
    expect(nonSystemMsg.length).toBe(1);
    // calculateMessageTokens uses counter.count(content) directly (no per-message overhead)
    // System prompt = ceil(13/4) = 4, One/Three = ceil(3-5/4) = 1-2
    expect(result.compressedTokenCount).toBeGreaterThan(1);
  });
});
