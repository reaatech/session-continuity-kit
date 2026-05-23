import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FirestoreAdapter } from '../src/FirestoreAdapter.js';
import { ConcurrencyError } from '@reaatech/session-continuity';
import type { Session } from '@reaatech/session-continuity';
import type { Firestore } from '@google-cloud/firestore';

/**
 * Mock Firestore that supports `runTransaction` with read-check-write semantics,
 * so the optimistic-concurrency path can be exercised.
 */
function createTxFirestore() {
  const docs = new Map<string, Record<string, unknown>>();

  const docRef = (path: string) => ({
    id: path.split('/').pop()!,
    path,
    get: vi.fn(async () => ({ exists: docs.has(path), data: () => docs.get(path) ?? null })),
    set: vi.fn(async (data: Record<string, unknown>) => {
      docs.set(path, { ...data });
    }),
    update: vi.fn(async (data: Record<string, unknown>) => {
      const existing = docs.get(path);
      if (existing) docs.set(path, { ...existing, ...data });
    }),
  });

  const collectionRef = (path: string) => ({
    doc: vi.fn((id?: string) => docRef(`${path}/${id ?? crypto.randomUUID()}`)),
  });

  return {
    docs,
    collection: vi.fn((name: string) => collectionRef(name)),
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: async (ref: { path: string }) => ({
          exists: docs.has(ref.path),
          data: () => docs.get(ref.path) ?? null,
        }),
        update: (ref: { path: string }, data: Record<string, unknown>) => {
          const existing = docs.get(ref.path);
          if (existing) docs.set(ref.path, { ...existing, ...data });
        },
      };
      return fn(tx);
    }),
    constructor: class MockFirestore {
      static Timestamp = { fromDate: (date: Date) => date };
    },
  };
}

describe('FirestoreAdapter — optimistic concurrency (#3)', () => {
  let firestore: ReturnType<typeof createTxFirestore>;
  let adapter: FirestoreAdapter;

  beforeEach(() => {
    firestore = createTxFirestore();
    adapter = new FirestoreAdapter({ firestore: firestore as unknown as Firestore });
  });

  function sessionData(): Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'> {
    return { status: 'active', metadata: {}, participants: [], schemaVersion: 1, version: 1 };
  }

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
  });

  it('enforces version on empty-update conflict checks', async () => {
    const s = await adapter.createSession(sessionData());
    await adapter.updateSession(s.id, { version: 2 }, { expectedVersion: 1 });
    await expect(adapter.updateSession(s.id, {}, { expectedVersion: 1 })).rejects.toThrow(
      ConcurrencyError
    );
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
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });
});
