import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryAdapter } from '../src/MemoryAdapter.js';
import type { Session } from '@reaatech/session-continuity';

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  function createSessionData(): Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'> {
    return {
      status: 'active',
      metadata: {},
      participants: [],
      schemaVersion: 1,
    };
  }

  it('creates and retrieves a session', async () => {
    const created = await adapter.createSession(createSessionData());
    expect(created.id).toBeDefined();
    expect(created.createdAt).toBeDefined();

    const retrieved = await adapter.getSession(created.id);
    expect(retrieved).toEqual(created);
  });

  it('returns null for missing session', async () => {
    const result = await adapter.getSession('missing');
    expect(result).toBeNull();
  });

  it('updates a session', async () => {
    const created = await adapter.createSession(createSessionData());
    const updated = await adapter.updateSession(created.id, { status: 'completed' });
    expect(updated.status).toBe('completed');
  });

  it('deletes a session', async () => {
    const created = await adapter.createSession(createSessionData());
    await adapter.deleteSession(created.id);
    expect(await adapter.getSession(created.id)).toBeNull();
  });

  it('lists sessions with filters', async () => {
    const s1 = await adapter.createSession({ ...createSessionData(), userId: 'u1' });
    await adapter.createSession({ ...createSessionData(), userId: 'u2' });

    const results = await adapter.listSessions({ userId: 'u1' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(s1.id);
  });

  it('adds and retrieves messages', async () => {
    const session = await adapter.createSession(createSessionData());
    const msg = await adapter.addMessage(session.id, {
      role: 'user',
      content: 'Hello',
    });

    expect(msg.id).toBeDefined();

    const messages = await adapter.getMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Hello');
  });

  it('filters messages by role', async () => {
    const session = await adapter.createSession(createSessionData());
    await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });
    await adapter.addMessage(session.id, { role: 'assistant', content: 'Hi' });

    const messages = await adapter.getMessages(session.id, { roles: ['user'] });
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  it('orders messages desc', async () => {
    const session = await adapter.createSession(createSessionData());
    await adapter.addMessage(session.id, { role: 'user', content: 'First' });
    await adapter.addMessage(session.id, { role: 'user', content: 'Second' });

    const messages = await adapter.getMessages(session.id, { order: 'desc' });
    expect(messages[0].content).toBe('Second');
  });

  it('deletes all messages', async () => {
    const session = await adapter.createSession(createSessionData());
    await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });
    await adapter.deleteAllMessages(session.id);

    const messages = await adapter.getMessages(session.id);
    expect(messages).toHaveLength(0);
  });

  it('returns expired sessions', async () => {
    const session = await adapter.createSession({
      ...createSessionData(),
      expiresAt: new Date(Date.now() - 1000),
    });

    const expired = await adapter.getExpiredSessions(new Date());
    expect(expired).toContain(session.id);
  });

  it('returns healthy status', async () => {
    const health = await adapter.health();
    expect(health.status).toBe('healthy');
  });

  it('simulates TTL', async () => {
    vi.useFakeTimers();
    const ttlAdapter = new MemoryAdapter({ ttlMs: 50 });
    const session = await ttlAdapter.createSession(createSessionData());

    expect(await ttlAdapter.getSession(session.id)).not.toBeNull();

    vi.advanceTimersByTime(100);
    expect(await ttlAdapter.getSession(session.id)).toBeNull();
    vi.useRealTimers();
  });

  it('updates a message', async () => {
    const session = await adapter.createSession(createSessionData());
    const msg = await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });
    const updated = await adapter.updateMessage(session.id, msg.id, { content: 'Updated' });
    expect(updated.content).toBe('Updated');
  });

  it('throws when updating message in missing session', async () => {
    await expect(adapter.updateMessage('missing', 'msg-1', { content: 'x' })).rejects.toThrow(
      'Session not found'
    );
  });

  it('throws when updating missing message', async () => {
    const session = await adapter.createSession(createSessionData());
    await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });
    await expect(adapter.updateMessage(session.id, 'missing', { content: 'x' })).rejects.toThrow(
      'Message not found'
    );
  });

  it('deletes a message', async () => {
    const session = await adapter.createSession(createSessionData());
    const msg = await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });
    await adapter.deleteMessage(session.id, msg.id);

    const messages = await adapter.getMessages(session.id);
    expect(messages).toHaveLength(0);
  });

  it('filters sessions by tags', async () => {
    const s1 = await adapter.createSession({
      ...createSessionData(),
      metadata: { tags: ['important'] },
    });
    await adapter.createSession({
      ...createSessionData(),
      metadata: { tags: ['other'] },
    });

    const results = await adapter.listSessions({ tags: ['important'] });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(s1.id);
  });

  it('filters sessions by createdAfter/createdBefore', async () => {
    const now = new Date();
    await adapter.createSession(createSessionData());

    const after = await adapter.listSessions({ createdAfter: new Date(now.getTime() - 10000) });
    expect(after.length).toBeGreaterThanOrEqual(1);

    const before = await adapter.listSessions({ createdBefore: new Date(now.getTime() - 10000) });
    expect(before).toHaveLength(0);
  });

  it('applies offset and limit', async () => {
    await adapter.createSession(createSessionData());
    await adapter.createSession(createSessionData());
    await adapter.createSession(createSessionData());

    const limited = await adapter.listSessions({ limit: 1 });
    expect(limited).toHaveLength(1);

    const offset = await adapter.listSessions({ offset: 1, limit: 1 });
    expect(offset).toHaveLength(1);
  });

  it('closes and clears data', async () => {
    const session = await adapter.createSession(createSessionData());
    await adapter.close();
    expect(await adapter.getSession(session.id)).toBeNull();
  });

  it('resets TTL on session update', async () => {
    vi.useFakeTimers();
    const ttlAdapter = new MemoryAdapter({ ttlMs: 100 });
    const session = await ttlAdapter.createSession(createSessionData());

    // Wait a bit then update
    vi.advanceTimersByTime(50);
    await ttlAdapter.updateSession(session.id, { status: 'paused' });

    // Wait another bit - should still exist because TTL was reset
    vi.advanceTimersByTime(60);
    expect(await ttlAdapter.getSession(session.id)).not.toBeNull();

    // Wait for full TTL to expire
    vi.advanceTimersByTime(150);
    expect(await ttlAdapter.getSession(session.id)).toBeNull();
    vi.useRealTimers();
  });
});
