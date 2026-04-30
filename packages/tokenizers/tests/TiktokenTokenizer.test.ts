import { describe, it, expect } from 'vitest';
import { TiktokenTokenizer } from '../src/TiktokenTokenizer.js';
import type { Message } from '@reaatech/session-continuity';

describe('TiktokenTokenizer', () => {
  it('counts tokens in a string', () => {
    const tokenizer = new TiktokenTokenizer('gpt-4');
    const count = tokenizer.count('Hello world');
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
  });

  it('counts tokens for messages with string content', () => {
    const tokenizer = new TiktokenTokenizer('gpt-4');
    const messages: Message[] = [
      { id: '1', sessionId: 's1', role: 'user', content: 'Hello', createdAt: new Date() },
      { id: '2', sessionId: 's1', role: 'assistant', content: 'Hi there', createdAt: new Date() },
    ];

    const count = tokenizer.countMessages(messages);
    expect(count).toBeGreaterThan(0);
  });

  it('counts tokens for messages with multimodal content', () => {
    const tokenizer = new TiktokenTokenizer('gpt-4');
    const messages: Message[] = [
      {
        id: '1',
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        createdAt: new Date(),
      },
    ];

    const count = tokenizer.countMessages(messages);
    expect(count).toBeGreaterThan(0);
  });

  it('counts tokens with toolCalls metadata', () => {
    const tokenizer = new TiktokenTokenizer('gpt-4');
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
    const tokenizer = new TiktokenTokenizer('gpt-4');
    expect(tokenizer.model).toBe('gpt-4');
    expect(tokenizer.tokenizer).toBe('tiktoken');
  });

  it('falls back to cl100k_base for unknown models', () => {
    const tokenizer = new TiktokenTokenizer('unknown-model');
    expect(tokenizer.model).toBe('unknown-model');
    // Should still work without throwing
    expect(tokenizer.count('test')).toBeGreaterThan(0);
  });

  it('uses p50k_base for text-davinci-003', () => {
    const tokenizer = new TiktokenTokenizer('text-davinci-003');
    expect(tokenizer.model).toBe('text-davinci-003');
    expect(tokenizer.count('test')).toBeGreaterThan(0);
  });
});
