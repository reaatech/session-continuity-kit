import { describe, it, expect } from 'vitest';
import { MessageWindow } from '../src/session/MessageWindow.js';
import type { Message } from '../src/types/session.js';
import type { TokenBudgetConfig } from '../src/types/token.js';
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

let messageTime = 1000;
function createMessage(
  content: string,
  role: Message['role'] = 'user',
  overrides?: Partial<Message>
): Message {
  messageTime += 1000;
  return {
    id: crypto.randomUUID(),
    sessionId: 'test-session',
    role,
    content,
    createdAt: new Date(messageTime),
    ...overrides,
  };
}

describe('MessageWindow', () => {
  const config: TokenBudgetConfig = {
    maxTokens: 100,
    reserveTokens: 20,
    overflowStrategy: 'truncate',
  };

  it('returns all messages when under budget', () => {
    const window = new MessageWindow({ tokenBudget: config }, mockCounter);
    const messages = [createMessage('Hello world', 'user'), createMessage('Hi there', 'assistant')];
    const fitted = window.getFittedMessages(messages);
    expect(fitted).toHaveLength(2);
  });

  it('always preserves system messages', () => {
    const window = new MessageWindow({ tokenBudget: config }, mockCounter);
    const messages = [
      createMessage('System prompt', 'system'),
      createMessage('A'.repeat(400), 'user'),
      createMessage('B'.repeat(400), 'assistant'),
    ];
    const fitted = window.getFittedMessages(messages);
    expect(fitted.some((m) => m.role === 'system')).toBe(true);
  });

  it('drops oldest non-system messages when over budget', () => {
    const window = new MessageWindow({ tokenBudget: config }, mockCounter);
    const messages = [
      createMessage('A'.repeat(200), 'user'),
      createMessage('B'.repeat(200), 'assistant'),
      createMessage('C'.repeat(200), 'user'),
    ];
    const fitted = window.getFittedMessages(messages);
    expect(fitted.length).toBeLessThan(messages.length);
    expect(fitted.length).toBeGreaterThan(0);
    // Newest message should be kept
    expect(fitted[fitted.length - 1].content).toBe('C'.repeat(200));
  });

  it('calculates token usage correctly', () => {
    const window = new MessageWindow({ tokenBudget: config }, mockCounter);
    const messages = [createMessage('System', 'system'), createMessage('Hello', 'user')];
    const usage = window.getTokenUsage(messages);
    expect(usage.totalTokens).toBeGreaterThan(0);
    expect(usage.systemTokens).toBeGreaterThan(0);
    expect(usage.isOverBudget).toBe(false);
  });
});
