import { describe, it, expect, vi } from 'vitest';
import type { Message } from '@session-continuity-kit/core';

// Mock node:module createRequire so we can fake the optional peer dependency
vi.mock('node:module', () => ({
  createRequire: () => () => ({
    getTokenizer: () => ({
      encode: (text: string) => new Uint32Array(new Array(Math.ceil(text.length / 4)).fill(0)),
      free: () => {},
    }),
  }),
}));

// Import after mocking
const { AnthropicTokenizer } = await import('../src/AnthropicTokenizer.js');

describe('AnthropicTokenizer', () => {
  it('counts tokens in a string', () => {
    const tokenizer = new AnthropicTokenizer('claude-3-sonnet');
    const count = tokenizer.count('Hello world');
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
  });

  it('counts tokens for messages with string content', () => {
    const tokenizer = new AnthropicTokenizer('claude-3-sonnet');
    const messages: Message[] = [
      { id: '1', sessionId: 's1', role: 'user', content: 'Hello', createdAt: new Date() },
      { id: '2', sessionId: 's1', role: 'assistant', content: 'Hi there', createdAt: new Date() },
    ];

    const count = tokenizer.countMessages(messages);
    expect(count).toBeGreaterThan(0);
  });

  it('counts tokens for messages with multimodal content', () => {
    const tokenizer = new AnthropicTokenizer('claude-3-sonnet');
    const messages: Message[] = [
      {
        id: '1',
        sessionId: 's1',
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image_url', image_url: { url: 'http://example.com/img.png' } },
        ],
        createdAt: new Date(),
      },
    ];

    const count = tokenizer.countMessages(messages);
    expect(count).toBeGreaterThan(0);
  });

  it('counts tokens with toolCalls metadata', () => {
    const tokenizer = new AnthropicTokenizer('claude-3-sonnet');
    const messages: Message[] = [
      {
        id: '1',
        sessionId: 's1',
        role: 'assistant',
        content: 'Using tool',
        createdAt: new Date(),
        metadata: {
          toolCalls: [{ name: 'get_weather', arguments: '{"city":"NYC"}' }],
        },
      },
    ];

    const countWithTools = tokenizer.countMessages(messages);
    const countWithoutTools = tokenizer.countMessages([{ ...messages[0], metadata: {} }]);
    expect(countWithTools).toBeGreaterThan(countWithoutTools);
  });

  it('returns correct model and tokenizer name', () => {
    const tokenizer = new AnthropicTokenizer('claude-3-sonnet');
    expect(tokenizer.model).toBe('claude-3-sonnet');
    expect(tokenizer.tokenizer).toBe('anthropic');
  });

  it('disposes without error', () => {
    const tokenizer = new AnthropicTokenizer('claude-3-sonnet');
    tokenizer.count('test'); // ensure encoding is initialized
    expect(() => tokenizer.dispose()).not.toThrow();
  });
});
