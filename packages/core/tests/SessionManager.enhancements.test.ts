import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../src/session/SessionManager.js';
import { MemoryAdapter } from '../../storage-memory/src/MemoryAdapter.js';
import { EstimateTokenizer } from '../../tokenizers/src/EstimateTokenizer.js';
import { SessionNotFoundError, ValidationError } from '../src/types/errors.js';
import type { TokenCounter } from '../src/types/token.js';
import type { Message } from '../src/types/session.js';
import type { SummarizerService } from '../src/types/compression.js';

/** Deterministic tokenizer: 1 token per character. */
function charTokenizer(): TokenCounter {
  return {
    model: 'test',
    tokenizer: 'char',
    count: (text: string) => text.length,
    countMessages: (messages: Message[]) =>
      messages.reduce(
        (sum, m) => sum + (m.tokenCount ?? (typeof m.content === 'string' ? m.content.length : 0)),
        0
      ),
  };
}

describe('SessionManager — running counts (#2)', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({
      storage: new MemoryAdapter(),
      tokenCounter: charTokenizer(),
    });
  });

  it('maintains tokenCount and messageCount incrementally', async () => {
    const s = await manager.createSession();
    expect(s.tokenCount).toBe(0);
    expect(s.messageCount).toBe(0);

    await manager.addMessage(s.id, { role: 'user', content: 'hello' }); // 5
    await manager.addMessage(s.id, { role: 'assistant', content: 'hi!' }); // 3

    const after = await manager.getSession(s.id);
    expect(after.messageCount).toBe(2);
    expect(after.tokenCount).toBe(8);
  });
});

describe('SessionManager — image token cost (#4)', () => {
  it('charges configured tokens per image_url block', async () => {
    const manager = new SessionManager({
      storage: new MemoryAdapter(),
      tokenCounter: charTokenizer(),
      imageTokenCost: 100,
    });
    const s = await manager.createSession();
    const msg = await manager.addMessage(s.id, {
      role: 'user',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
      ],
    });
    expect(msg.tokenCount).toBe(2 + 100);
    const after = await manager.getSession(s.id);
    expect(after.tokenCount).toBe(102);
  });

  it('defaults to zero (text-only behavior) when not configured', async () => {
    const manager = new SessionManager({
      storage: new MemoryAdapter(),
      tokenCounter: charTokenizer(),
    });
    const s = await manager.createSession();
    const msg = await manager.addMessage(s.id, {
      role: 'user',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
      ],
    });
    expect(msg.tokenCount).toBe(2);
  });
});

describe('SessionManager — surfaced repository methods (#5)', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({
      storage: new MemoryAdapter(),
      tokenCounter: charTokenizer(),
    });
  });

  it('lists sessions filtered by user', async () => {
    await manager.createSession({ userId: 'a' });
    await manager.createSession({ userId: 'a' });
    await manager.createSession({ userId: 'b' });
    const forA = await manager.listSessions({ userId: 'a' });
    expect(forA).toHaveLength(2);
  });

  it('updates a message and adjusts the running token total', async () => {
    const s = await manager.createSession();
    const m = await manager.addMessage(s.id, { role: 'user', content: 'hello' }); // 5
    await manager.updateMessage(s.id, m.id, { content: 'hello world' }); // 11
    const after = await manager.getSession(s.id);
    expect(after.tokenCount).toBe(11);
    const messages = await manager.getMessages(s.id);
    expect(messages[0].content).toBe('hello world');
    expect(messages[0].tokenCount).toBe(11);
  });

  it('deletes a message and decrements counts', async () => {
    const s = await manager.createSession();
    const m1 = await manager.addMessage(s.id, { role: 'user', content: 'hello' }); // 5
    await manager.addMessage(s.id, { role: 'assistant', content: 'hey' }); // 3
    await manager.deleteMessage(s.id, m1.id);
    const after = await manager.getSession(s.id);
    expect(after.messageCount).toBe(1);
    expect(after.tokenCount).toBe(3);
  });

  it('throws when updating a message that does not exist', async () => {
    const s = await manager.createSession();
    await expect(manager.updateMessage(s.id, 'nope', { content: 'x' })).rejects.toThrow(
      ValidationError
    );
  });

  it('emits message:updated and message:deleted', async () => {
    const s = await manager.createSession();
    const m = await manager.addMessage(s.id, { role: 'user', content: 'hello' });
    const updated = vi.fn();
    const deleted = vi.fn();
    manager.on('message:updated', updated);
    manager.on('message:deleted', deleted);
    await manager.updateMessage(s.id, m.id, { content: 'changed' });
    await manager.deleteMessage(s.id, m.id);
    expect(updated).toHaveBeenCalledTimes(1);
    expect(deleted).toHaveBeenCalledTimes(1);
  });
});

describe('SessionManager — existence checks (#7)', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({
      storage: new MemoryAdapter(),
      tokenCounter: charTokenizer(),
    });
  });

  it('endSession throws on a missing session', async () => {
    await expect(manager.endSession('nope')).rejects.toThrow(SessionNotFoundError);
  });

  it('deleteSession throws on a missing session', async () => {
    await expect(manager.deleteSession('nope')).rejects.toThrow(SessionNotFoundError);
  });
});

describe('SessionManager — context stats (#8/#9)', () => {
  it('reports budget and compression diagnostics', async () => {
    const manager = new SessionManager({
      storage: new MemoryAdapter(),
      tokenCounter: charTokenizer(),
      tokenBudget: { maxTokens: 6, reserveTokens: 0, overflowStrategy: 'truncate' },
    });
    const s = await manager.createSession();
    await manager.addMessage(s.id, { role: 'user', content: 'aaaaa' }); // 5
    await manager.addMessage(s.id, { role: 'assistant', content: 'bbbbb' }); // 5

    const result = await manager.getConversationContextWithStats(s.id);
    expect(result.budget).toBeDefined();
    expect(result.compression?.applied).toBe(true);
    expect(result.compression?.originalTokenCount).toBe(10);
    expect(result.compression?.droppedMessageCount).toBeGreaterThan(0);
    expect(result.messages.length).toBeLessThan(2);
  });
});

describe('SessionManager — summary caching (#1)', () => {
  it('reuses a cached summary instead of re-invoking the summarizer', async () => {
    const summarize = vi.fn(async () => 'SUMMARY');
    const summarizer: SummarizerService = { summarize };

    const manager = new SessionManager({
      storage: new MemoryAdapter(),
      tokenCounter: charTokenizer(),
      tokenBudget: { maxTokens: 20, reserveTokens: 0, overflowStrategy: 'compress' },
      compression: {
        strategy: 'summarization',
        targetTokens: 15,
        summarizer,
        summaryOverhead: 0,
      },
    });

    const s = await manager.createSession();
    await manager.addMessage(s.id, { role: 'user', content: 'message one' }); // 11
    await manager.addMessage(s.id, { role: 'assistant', content: 'message two' }); // 11
    await manager.addMessage(s.id, { role: 'user', content: 'message three' }); // 13

    // First fetch: over budget → summarizer runs and caches.
    const first = await manager.getConversationContextWithStats(s.id);
    expect(first.compression?.applied).toBe(true);
    expect(first.compression?.fromCache).toBe(false);
    expect(first.compression?.summary).toBe('SUMMARY');
    expect(summarize).toHaveBeenCalledTimes(1);

    // Second fetch, no new messages: served from cache, no new LLM call.
    const second = await manager.getConversationContextWithStats(s.id);
    expect(second.compression?.fromCache).toBe(true);
    expect(summarize).toHaveBeenCalledTimes(1);
    // Cache reconstruction yields a summary system message.
    expect(second.messages.some((m) => String(m.content).includes('SUMMARY'))).toBe(true);

    // New message invalidates the cache → summarizer runs again.
    await manager.addMessage(s.id, { role: 'assistant', content: 'message four' });
    const third = await manager.getConversationContextWithStats(s.id);
    expect(third.compression?.fromCache).toBe(false);
    expect(summarize).toHaveBeenCalledTimes(2);
  });
});

describe('SessionManager — concurrency retry (#3)', () => {
  it('lands every concurrent participant add via CAS retry', async () => {
    const manager = new SessionManager({
      storage: new MemoryAdapter(),
      tokenCounter: new EstimateTokenizer(),
    });
    const s = await manager.createSession();

    await Promise.all([
      manager.addParticipant(s.id, { id: 'p1', role: 'user' }),
      manager.addParticipant(s.id, { id: 'p2', role: 'agent' }),
      manager.addParticipant(s.id, { id: 'p3', role: 'observer' }),
    ]);

    const participants = await manager.getParticipants(s.id);
    expect(participants.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
  });
});
