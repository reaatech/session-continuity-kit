import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisAdapter } from '../src/RedisAdapter.js';
import { ConcurrencyError } from '@reaatech/session-continuity';
import type { Session } from '@reaatech/session-continuity';
import type { RedisClientType } from 'redis';

/**
 * Mock Redis client supporting hashes plus WATCH/MULTI/EXEC, so the optimistic
 * concurrency path can be exercised. `execResult` lets a test force EXEC to
 * return null (the watched-key-changed signal).
 */
function createWatchClient(opts: { execResult?: null } = {}) {
  const store = new Map<string, Record<string, string>>();
  const sets = new Map<string, Set<string>>();

  return {
    store,
    hSet: vi.fn(async (key: string, values: Record<string, string>) => {
      store.set(key, { ...(store.get(key) ?? {}), ...values });
    }),
    hGetAll: vi.fn(async (key: string) => store.get(key) ?? {}),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    expire: vi.fn(async () => {}),
    sAdd: vi.fn(async (key: string, value: string) => {
      const s = sets.get(key) ?? new Set();
      s.add(value);
      sets.set(key, s);
    }),
    sRem: vi.fn(async (key: string, value: string) => {
      sets.get(key)?.delete(value);
    }),
    watch: vi.fn(async () => {}),
    unwatch: vi.fn(async () => {}),
    multi: vi.fn(() => {
      const ops: Array<() => void> = [];
      const chain = {
        del: vi.fn((key: string) => {
          ops.push(() => store.delete(key));
          return chain;
        }),
        hSet: vi.fn((key: string, values: Record<string, string>) => {
          ops.push(() => store.set(key, { ...(store.get(key) ?? {}), ...values }));
          return chain;
        }),
        expire: vi.fn(() => chain),
        exec: vi.fn(async () => {
          if (opts.execResult === null) return null;
          for (const op of ops) op();
          return ops.map(() => 'OK');
        }),
      };
      return chain;
    }),
    quit: vi.fn(async () => {}),
  };
}

function sessionData(): Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'> {
  return { status: 'active', metadata: {}, participants: [], schemaVersion: 1, version: 1 };
}

describe('RedisAdapter — optimistic concurrency (#3)', () => {
  let client: ReturnType<typeof createWatchClient>;
  let adapter: RedisAdapter;

  beforeEach(() => {
    client = createWatchClient();
    adapter = new RedisAdapter({ client: client as unknown as RedisClientType });
  });

  it('rejects a stale conditional write with ConcurrencyError', async () => {
    const s = await adapter.createSession(sessionData());
    await adapter.updateSession(s.id, { status: 'paused', version: 2 }, { expectedVersion: 1 });
    await expect(
      adapter.updateSession(s.id, { status: 'completed', version: 2 }, { expectedVersion: 1 })
    ).rejects.toThrow(ConcurrencyError);
  });

  it('reports the actual stored version on conflict', async () => {
    const s = await adapter.createSession(sessionData());
    await adapter.updateSession(s.id, { status: 'paused', version: 2 }, { expectedVersion: 1 });
    await expect(
      adapter.updateSession(s.id, { status: 'completed' }, { expectedVersion: 1 })
    ).rejects.toMatchObject({ expectedVersion: 1, actualVersion: 2 });
  });

  it('accepts a conditional write when the version matches', async () => {
    const s = await adapter.createSession(sessionData());
    const updated = await adapter.updateSession(
      s.id,
      { status: 'completed', version: 2 },
      { expectedVersion: 1 }
    );
    expect(updated.status).toBe('completed');
    expect(updated.version).toBe(2);
    expect(client.watch).toHaveBeenCalledWith(`session:${s.id}`);
  });

  it('treats a null EXEC (watched key changed) as a conflict', async () => {
    const racingClient = createWatchClient({ execResult: null });
    const racingAdapter = new RedisAdapter({ client: racingClient as unknown as RedisClientType });
    const s = await racingAdapter.createSession(sessionData());
    await expect(
      racingAdapter.updateSession(s.id, { status: 'completed' }, { expectedVersion: 1 })
    ).rejects.toThrow(ConcurrencyError);
  });

  it('throws when the session does not exist', async () => {
    await expect(
      adapter.updateSession('missing', { status: 'completed' }, { expectedVersion: 1 })
    ).rejects.toThrow();
  });

  it('applies unconditionally when no expectedVersion is given', async () => {
    const s = await adapter.createSession(sessionData());
    const updated = await adapter.updateSession(s.id, { status: 'completed' });
    expect(updated.status).toBe('completed');
    expect(client.watch).not.toHaveBeenCalled();
  });
});
