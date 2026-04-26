import { describe, it, expect } from 'vitest';
import {
  calculateMessageTokens,
  preserveSystemMessages,
  fitMessagesWithinBudget,
} from '../src/compression/CompressionStrategy.js';
import type { Message } from '../src/types/session.js';
import type { TokenCounter } from '../src/types/token.js';

const mockCounter: TokenCounter = {
  count: (text: string) => text.length,
  countMessages: (messages: Message[]) =>
    messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0),
  model: 'mock',
  tokenizer: 'mock',
};

describe('calculateMessageTokens', () => {
  it('uses cached tokenCount if available', () => {
    const message: Message = {
      id: '1',
      sessionId: 's1',
      role: 'user',
      content: 'Hello world',
      tokenCount: 5,
      createdAt: new Date(),
    };
    expect(calculateMessageTokens(message, mockCounter)).toBe(5);
  });

  it('counts string content', () => {
    const message: Message = {
      id: '1',
      sessionId: 's1',
      role: 'user',
      content: 'Hello',
      createdAt: new Date(),
    };
    expect(calculateMessageTokens(message, mockCounter)).toBe(5);
  });

  it('counts multimodal content by extracting text blocks only', () => {
    const message: Message = {
      id: '1',
      sessionId: 's1',
      role: 'user',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      ],
      createdAt: new Date(),
    };
    // Only the text block 'hi' (2 chars) is counted; image_url blocks are excluded
    expect(calculateMessageTokens(message, mockCounter)).toBe(2);
  });

  it('adds tool call tokens', () => {
    const message: Message = {
      id: '1',
      sessionId: 's1',
      role: 'assistant',
      content: 'Using tool',
      metadata: {
        toolCalls: [{ name: 'get_weather', arguments: '{"city":"NYC"}' }],
      },
      createdAt: new Date(),
    };
    const base = mockCounter.count('Using tool');
    const toolName = mockCounter.count('get_weather');
    const toolArgs = mockCounter.count('{"city":"NYC"}');
    expect(calculateMessageTokens(message, mockCounter)).toBe(base + toolName + toolArgs);
  });

  it('handles message without toolCalls', () => {
    const message: Message = {
      id: '1',
      sessionId: 's1',
      role: 'user',
      content: 'Hello',
      createdAt: new Date(),
    };
    expect(calculateMessageTokens(message, mockCounter)).toBe(5);
  });

  it('adds tool result tokens', () => {
    const message: Message = {
      id: '1',
      sessionId: 's1',
      role: 'tool',
      content: 'Result',
      metadata: {
        toolResults: [{ toolCallId: 'tc1', result: 'Sunny weather', isError: false }],
      },
      createdAt: new Date(),
    };
    const base = mockCounter.count('Result');
    const toolResult = mockCounter.count('Sunny weather');
    expect(calculateMessageTokens(message, mockCounter)).toBe(base + toolResult);
  });
});

describe('preserveSystemMessages', () => {
  it('separates system from other messages', () => {
    const system: Message = {
      id: '1',
      sessionId: 's1',
      role: 'system',
      content: 'Sys',
      createdAt: new Date(),
    };
    const user: Message = {
      id: '2',
      sessionId: 's1',
      role: 'user',
      content: 'User',
      createdAt: new Date(),
    };
    const assistant: Message = {
      id: '3',
      sessionId: 's1',
      role: 'assistant',
      content: 'Assist',
      createdAt: new Date(),
    };

    const result = preserveSystemMessages([system, user, assistant]);
    expect(result.systemMessages).toEqual([system]);
    expect(result.otherMessages).toEqual([user, assistant]);
  });

  it('handles empty array', () => {
    const result = preserveSystemMessages([]);
    expect(result.systemMessages).toEqual([]);
    expect(result.otherMessages).toEqual([]);
  });
});

describe('fitMessagesWithinBudget', () => {
  it('keeps all messages if under budget', () => {
    const messages: Message[] = [
      { id: '1', sessionId: 's1', role: 'user', content: 'A', createdAt: new Date(2024, 0, 1) },
      {
        id: '2',
        sessionId: 's1',
        role: 'assistant',
        content: 'B',
        createdAt: new Date(2024, 0, 2),
      },
    ];
    const result = fitMessagesWithinBudget(messages, 100, mockCounter);
    expect(result.kept).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });

  it('drops oldest non-system messages when over budget', () => {
    const messages: Message[] = [
      { id: '1', sessionId: 's1', role: 'user', content: 'AAAA', createdAt: new Date(2024, 0, 1) },
      {
        id: '2',
        sessionId: 's1',
        role: 'assistant',
        content: 'BBBB',
        createdAt: new Date(2024, 0, 2),
      },
      { id: '3', sessionId: 's1', role: 'user', content: 'CCCC', createdAt: new Date(2024, 0, 3) },
    ];
    const result = fitMessagesWithinBudget(messages, 10, mockCounter);
    // Should keep newest messages first
    expect(result.kept.length).toBeLessThan(3);
    expect(result.removed.length).toBeGreaterThan(0);
  });

  it('always preserves system messages', () => {
    const system: Message = {
      id: '1',
      sessionId: 's1',
      role: 'system',
      content: 'SYS',
      createdAt: new Date(2024, 0, 1),
    };
    const user: Message = {
      id: '2',
      sessionId: 's1',
      role: 'user',
      content: 'USER',
      createdAt: new Date(2024, 0, 2),
    };

    const result = fitMessagesWithinBudget([system, user], 2, mockCounter);
    expect(result.kept.some((m) => m.role === 'system')).toBe(true);
  });
});
