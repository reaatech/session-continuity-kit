import { describe, it, expect } from 'vitest';
import { EstimateTokenizer } from '../src/EstimateTokenizer.js';
import type { Message } from '@session-continuity-kit/core';

describe('EstimateTokenizer', () => {
  it('estimates token count for text', () => {
    const tokenizer = new EstimateTokenizer(4);
    expect(tokenizer.count('hello world')).toBe(3); // 11 chars / 4 = 2.75 -> 3
  });

  it('counts messages with overhead', () => {
    const tokenizer = new EstimateTokenizer(4);
    const messages: Message[] = [
      { id: '1', sessionId: 's1', role: 'user', content: 'hello', createdAt: new Date() },
      { id: '2', sessionId: 's1', role: 'assistant', content: 'world', createdAt: new Date() },
    ];

    const count = tokenizer.countMessages(messages);
    // (5+5)/4 = 2.5 -> 3 + 2*3 role overhead + 3 list overhead = 12
    expect(count).toBe(12);
  });

  it('reports model and tokenizer name', () => {
    const tokenizer = new EstimateTokenizer();
    expect(tokenizer.model).toBe('estimate');
    expect(tokenizer.tokenizer).toBe('estimate');
  });

  it('counts multimodal message content', () => {
    const tokenizer = new EstimateTokenizer(4);
    const messages: Message[] = [
      {
        id: '1',
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
        createdAt: new Date(),
      },
    ];
    // Only text content is counted, not the JSON of the whole array
    expect(tokenizer.countMessages(messages)).toBe(Math.ceil(2 / 4) + 3 + 3); // +3 role +3 list
  });

  it('exposes dispose method', () => {
    const tokenizer = new EstimateTokenizer();
    expect(() => tokenizer.dispose()).not.toThrow();
  });

  it('throws for invalid charsPerToken', () => {
    expect(() => new EstimateTokenizer(0)).toThrow('charsPerToken must be greater than 0');
    expect(() => new EstimateTokenizer(-1)).toThrow('charsPerToken must be greater than 0');
  });
});
