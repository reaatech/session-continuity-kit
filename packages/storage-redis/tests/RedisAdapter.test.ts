import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisAdapter } from '../src/RedisAdapter.js';
import type { Session } from '@session-continuity-kit/core';

describe('RedisAdapter', () => {
  let adapter: RedisAdapter;
  let store: Map<string, Record<string, string>> = new Map();
  let sets: Map<string, Set<string>> = new Map();
  let zsets: Map<string, Array<{ value: string; score: number }>> = new Map();

  function createMockClient() {
    store = new Map();
    sets = new Map();
    zsets = new Map();

    return {
      hSet: vi.fn(async (key: string, values: Record<string, string>) => {
        const existing = store.get(key) ?? {};
        store.set(key, { ...existing, ...values });
      }),
      hGetAll: vi.fn(async (key: string) => {
        return store.get(key) ?? {};
      }),
      hDel: vi.fn(async (key: string, field: string) => {
        const data = store.get(key);
        if (data) delete data[field];
      }),
      del: vi.fn(async (key: string) => {
        store.delete(key);
        sets.delete(key);
        zsets.delete(key);
      }),
      zAdd: vi.fn(async (key: string, member: { score: number; value: string }) => {
        const existing = zsets.get(key) ?? [];
        const idx = existing.findIndex((m) => m.value === member.value);
        if (idx >= 0) existing[idx] = member;
        else existing.push(member);
        zsets.set(key, existing);
      }),
      zRangeByScore: vi.fn(async (key: string, _min: string, _max: string) => {
        const existing = zsets.get(key) ?? [];
        return existing.sort((a, b) => a.score - b.score).map((m) => m.value);
      }),
      zRem: vi.fn(async (key: string, value: string) => {
        const existing = zsets.get(key) ?? [];
        zsets.set(
          key,
          existing.filter((m) => m.value !== value)
        );
      }),
      zRange: vi.fn(
        async (key: string, start: number, stop: number, options?: { REV?: boolean }) => {
          const existing = zsets.get(key) ?? [];
          const sorted = existing.sort((a, b) =>
            options?.REV ? b.score - a.score : a.score - b.score
          );
          const end = stop === -1 ? sorted.length : stop + 1;
          return sorted.slice(start, end).map((m) => m.value);
        }
      ),
      zRevRange: vi.fn(async (key: string, start: number, stop: number) => {
        const existing = zsets.get(key) ?? [];
        const sorted = existing.sort((a, b) => b.score - a.score);
        const end = stop === -1 ? sorted.length : stop + 1;
        return sorted.slice(start, end).map((m) => m.value);
      }),
      sAdd: vi.fn(async (key: string, value: string) => {
        const existing = sets.get(key) ?? new Set();
        existing.add(value);
        sets.set(key, existing);
      }),
      sRem: vi.fn(async (key: string, value: string) => {
        const existing = sets.get(key);
        if (existing) existing.delete(value);
      }),
      sMembers: vi.fn(async (key: string) => {
        const existing = sets.get(key);
        return existing ? Array.from(existing) : [];
      }),
      expire: vi.fn(async () => {}),
      scan: vi.fn(async (_cursor: number, _options?: unknown) => {
        const keys = Array.from(store.keys());
        return { cursor: 0, keys };
      }),
      ping: vi.fn(async () => 'PONG'),
      multi: vi.fn(() => {
        const keysToDelete: string[] = [];
        return {
          del: vi.fn(function (key: string) {
            keysToDelete.push(key);
            return this;
          }),
          exec: vi.fn(async () => {
            for (const key of keysToDelete) {
              store.delete(key);
              sets.delete(key);
              zsets.delete(key);
            }
          }),
        };
      }),
      quit: vi.fn(async () => {}),
    };
  }

  beforeEach(() => {
    const mockClient = createMockClient();
    adapter = new RedisAdapter({
      client: mockClient as unknown as import('redis').RedisClientType,
    });
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

    const retrieved = await adapter.getSession(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(created.id);
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

  it('deletes a session and its messages', async () => {
    const created = await adapter.createSession(createSessionData());
    await adapter.addMessage(created.id, { role: 'user', content: 'Hello' });
    await adapter.deleteSession(created.id);

    expect(await adapter.getSession(created.id)).toBeNull();
  });

  it('adds and retrieves messages', async () => {
    const session = await adapter.createSession(createSessionData());
    const msg = await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });

    expect(msg.content).toBe('Hello');

    const messages = await adapter.getMessages(session.id);
    expect(messages).toHaveLength(1);
  });

  it('orders messages desc', async () => {
    const session = await adapter.createSession(createSessionData());
    await adapter.addMessage(session.id, { role: 'user', content: 'First' });
    await new Promise((r) => setTimeout(r, 10));
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

  it('round-trips multimodal message content', async () => {
    const session = await adapter.createSession(createSessionData());
    const content = [
      { type: 'text' as const, text: 'Hello' },
      { type: 'image_url' as const, image_url: { url: 'http://example.com/img.png' } },
    ];
    const message = await adapter.addMessage(session.id, {
      role: 'user',
      content,
    });

    expect(message.content).toEqual(content);

    const messages = await adapter.getMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual(content);
  });

  it('updates a message', async () => {
    const session = await adapter.createSession(createSessionData());
    const msg = await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });
    const updated = await adapter.updateMessage(session.id, msg.id, { content: 'Updated' });
    expect(updated.content).toBe('Updated');
  });

  it('deletes a message', async () => {
    const session = await adapter.createSession(createSessionData());
    const msg = await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });
    await adapter.deleteMessage(session.id, msg.id);

    const messages = await adapter.getMessages(session.id);
    expect(messages).toHaveLength(0);
  });

  it('lists sessions with userId filter', async () => {
    const s1 = await adapter.createSession({ ...createSessionData(), userId: 'u1' });
    await adapter.createSession({ ...createSessionData(), userId: 'u2' });

    const results = await adapter.listSessions({ userId: 'u1' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(s1.id);
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

  it('lists sessions via scan when no userId filter', async () => {
    await adapter.createSession({ ...createSessionData(), status: 'active' });
    await adapter.createSession({ ...createSessionData(), status: 'active' });
    const results = await adapter.listSessions();
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('lists sessions with status filter via scan', async () => {
    await adapter.createSession({ ...createSessionData(), status: 'active' });
    await adapter.createSession({ ...createSessionData(), status: 'completed' });
    const results = await adapter.listSessions({ status: 'completed' });
    expect(results).toHaveLength(1);
  });

  it('closes without error', async () => {
    await adapter.close();
  });

  it('throws StorageError on create failure', async () => {
    const failingClient = createMockClient();
    failingClient.hSet = vi.fn(async () => {
      throw new Error('Redis down');
    });
    const failingAdapter = new RedisAdapter({
      client: failingClient as unknown as import('redis').RedisClientType,
    });

    await expect(failingAdapter.createSession(createSessionData())).rejects.toThrow(
      'Failed to create session'
    );
  });
});
