import { describe, it, expect } from 'vitest';
import { MockSummarizerService } from '../src/compression/SummarizerService.js';
import type { Message } from '../src/types/session.js';

describe('MockSummarizerService', () => {
  it('summarizes string messages', async () => {
    const service = new MockSummarizerService();
    const messages: Message[] = [
      { id: '1', sessionId: 's1', role: 'user', content: 'Hello world', createdAt: new Date() },
      {
        id: '2',
        sessionId: 's1',
        role: 'assistant',
        content: 'How can I help',
        createdAt: new Date(),
      },
    ];

    const summary = await service.summarize(messages);
    expect(summary).toContain('Summary of 2 messages');
    expect(summary).toContain('Hello');
  });

  it('handles multimodal content', async () => {
    const service = new MockSummarizerService();
    const messages: Message[] = [
      {
        id: '1',
        sessionId: 's1',
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
        createdAt: new Date(),
      },
    ];

    const summary = await service.summarize(messages);
    expect(summary).toContain('[multi-modal content]');
  });

  it('includes prompt when provided', async () => {
    const service = new MockSummarizerService();
    const messages: Message[] = [
      { id: '1', sessionId: 's1', role: 'user', content: 'Hello', createdAt: new Date() },
    ];

    const summary = await service.summarize(messages, 'Be concise');
    expect(summary).toContain('prompt: Be concise');
  });

  it('truncates long content to 10 words', async () => {
    const service = new MockSummarizerService();
    const messages: Message[] = [
      {
        id: '1',
        sessionId: 's1',
        role: 'user',
        content: 'a b c d e f g h i j k l m',
        createdAt: new Date(),
      },
    ];

    const summary = await service.summarize(messages);
    // Should only include first 10 words
    expect(summary).toContain('a b c d e f g h i j');
    expect(summary).not.toContain('k');
  });
});
