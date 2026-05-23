import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RedisAdapter } from '../src/RedisAdapter.js';
import type { Session } from '@reaatech/session-continuity';
import type { RedisClientType } from 'redis';

/** Mock Redis client with hashes, sorted sets, and an atomic INCR counter. */
function createSeqClient() {
  const store = new Map<string, Record<string, string>>();
  const zsets = new Map<string, Array<{ value: string; score: number }>>();
  const counters = new Map<string, number>();

  return {
    hSet: vi.fn(async (key: string, values: Record<string, string>) => {
      store.set(key, { ...(store.get(key) ?? {}), ...values });
    }),
    hGetAll: vi.fn(async (key: string) => store.get(key) ?? {}),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      zsets.delete(key);
      counters.delete(key);
    }),
    incr: vi.fn(async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    zAdd: vi.fn(async (key: string, member: { score: number; value: string }) => {
      const arr = zsets.get(key) ?? [];
      const idx = arr.findIndex((m) => m.value === member.value);
      if (idx >= 0) arr[idx] = member;
      else arr.push(member);
      zsets.set(key, arr);
    }),
    zRange: vi.fn(async (key: string, start: number, stop: number, options?: { REV?: boolean }) => {
      const arr = [...(zsets.get(key) ?? [])].sort((a, b) =>
        options?.REV ? b.score - a.score : a.score - b.score
      );
      const end = stop === -1 ? arr.length : stop + 1;
      return arr.slice(start, end).map((m) => m.value);
    }),
    zRem: vi.fn(async () => {}),
    expire: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
  };
}

function sessionData(): Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'> {
  return { status: 'active', metadata: {}, participants: [], schemaVersion: 1, version: 1 };
}

describe('RedisAdapter — monotonic sequence ordering (#6)', () => {
  let adapter: RedisAdapter;

  beforeEach(() => {
    adapter = new RedisAdapter({ client: createSeqClient() as unknown as RedisClientType });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('assigns increasing per-session sequence numbers', async () => {
    const s = await adapter.createSession(sessionData());
    const a = await adapter.addMessage(s.id, { role: 'user', content: 'a' });
    const b = await adapter.addMessage(s.id, { role: 'assistant', content: 'b' });
    const c = await adapter.addMessage(s.id, { role: 'user', content: 'c' });
    expect([a.sequence, b.sequence, c.sequence]).toEqual([1, 2, 3]);
  });

  it('orders deterministically even when timestamps collide', async () => {
    // Freeze time so every message shares the same createdAt millisecond.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const s = await adapter.createSession(sessionData());
    await adapter.addMessage(s.id, { role: 'user', content: 'first' });
    await adapter.addMessage(s.id, { role: 'assistant', content: 'second' });
    await adapter.addMessage(s.id, { role: 'user', content: 'third' });

    const ordered = await adapter.getMessages(s.id, { order: 'asc' });
    expect(ordered.map((m) => m.content)).toEqual(['first', 'second', 'third']);
    expect(ordered.map((m) => m.sequence)).toEqual([1, 2, 3]);
  });

  it('round-trips the sequence through storage', async () => {
    const s = await adapter.createSession(sessionData());
    await adapter.addMessage(s.id, { role: 'user', content: 'hi' });
    const [msg] = await adapter.getMessages(s.id);
    expect(msg.sequence).toBe(1);
  });
});
