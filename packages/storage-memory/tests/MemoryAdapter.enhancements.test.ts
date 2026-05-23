import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryAdapter } from '../src/MemoryAdapter.js';
import { ConcurrencyError } from '@reaatech/session-continuity';
import type { Session } from '@reaatech/session-continuity';

function sessionData(
  overrides: Partial<Session> = {}
): Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'> {
  return {
    status: 'active',
    metadata: {},
    participants: [],
    schemaVersion: 1,
    version: 1,
    ...overrides,
  };
}

describe('MemoryAdapter — monotonic sequence (#6)', () => {
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  it('assigns increasing per-session sequence numbers', async () => {
    const s = await adapter.createSession(sessionData());
    const a = await adapter.addMessage(s.id, { role: 'user', content: 'a' });
    const b = await adapter.addMessage(s.id, { role: 'assistant', content: 'b' });
    const c = await adapter.addMessage(s.id, { role: 'user', content: 'c' });
    expect([a.sequence, b.sequence, c.sequence]).toEqual([1, 2, 3]);
  });

  it('orders deterministically when timestamps collide', async () => {
    const s = await adapter.createSession(sessionData());
    // Force identical createdAt by stubbing Date within the same tick.
    const created = [];
    for (const content of ['first', 'second', 'third']) {
      created.push(await adapter.addMessage(s.id, { role: 'user', content }));
    }
    // Overwrite createdAt to a shared instant to simulate a same-ms burst.
    const shared = new Date('2026-01-01T00:00:00.000Z');
    for (const m of created) {
      await adapter.updateMessage(s.id, m.id, { createdAt: shared });
    }
    const ordered = await adapter.getMessages(s.id, { order: 'asc' });
    expect(ordered.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });
});

describe('MemoryAdapter — optimistic concurrency (#3)', () => {
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  it('rejects a stale conditional write with ConcurrencyError', async () => {
    const s = await adapter.createSession(sessionData({ version: 1 }));
    // Someone else bumps the version first.
    await adapter.updateSession(s.id, { status: 'paused', version: 2 });
    // A writer still holding version 1 is rejected.
    await expect(
      adapter.updateSession(s.id, { status: 'completed' }, { expectedVersion: 1 })
    ).rejects.toThrow(ConcurrencyError);
  });

  it('accepts a conditional write when the version matches', async () => {
    const s = await adapter.createSession(sessionData({ version: 1 }));
    const updated = await adapter.updateSession(
      s.id,
      { status: 'completed', version: 2 },
      { expectedVersion: 1 }
    );
    expect(updated.status).toBe('completed');
    expect(updated.version).toBe(2);
  });
});
