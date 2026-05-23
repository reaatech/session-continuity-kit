import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FirestoreAdapter } from '../src/FirestoreAdapter.js';
import type { Session } from '@reaatech/session-continuity';
import type { Firestore } from '@google-cloud/firestore';

/**
 * Mock Firestore whose message queries reproduce Firestore's real ordering:
 * `orderBy('createdAt')` with an implicit `__name__` (document id) tie-breaker.
 * This is what lets time-sortable document ids yield insertion order.
 */
function createOrderingFirestore() {
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
    collection: (name: string) => collectionRef(`${path}/${name}`),
  });

  const queryFor = (prefix: string, dir: 'asc' | 'desc') => ({
    where: vi.fn(() => queryFor(prefix, dir)),
    orderBy: vi.fn((_field: string, d?: 'asc' | 'desc') => queryFor(prefix, d ?? dir)),
    limit: vi.fn(() => queryFor(prefix, dir)),
    offset: vi.fn(() => queryFor(prefix, dir)),
    get: vi.fn(async () => {
      const entries = [...docs.entries()]
        .filter(([key]) => key.startsWith(prefix + '/'))
        .sort(([ka, va], [kb, vb]) => {
          const ta = (va.createdAt as Date).getTime();
          const tb = (vb.createdAt as Date).getTime();
          // Primary: createdAt. Tie-break: document id (Firestore's implicit __name__).
          const byTime = ta - tb;
          const cmp = byTime !== 0 ? byTime : ka < kb ? -1 : ka > kb ? 1 : 0;
          return dir === 'desc' ? -cmp : cmp;
        });
      return {
        docs: entries.map(([key, value]) => ({
          id: key.split('/').pop()!,
          data: () => value,
          ref: docRef(key),
        })),
      };
    }),
  });

  const collectionRef = (path: string) => ({
    doc: vi.fn((id?: string) => docRef(`${path}/${id ?? Math.random().toString(36).slice(2)}`)),
    where: vi.fn(() => queryFor(path, 'asc')),
    orderBy: vi.fn((_field: string, d?: 'asc' | 'desc') => queryFor(path, d ?? 'asc')),
    limit: vi.fn(() => queryFor(path, 'asc')),
    offset: vi.fn(() => queryFor(path, 'asc')),
    get: vi.fn(async () => (await queryFor(path, 'asc').get()) as unknown),
  });

  return {
    docs,
    collection: vi.fn((name: string) => collectionRef(name)),
    constructor: class MockFirestore {
      static Timestamp = { fromDate: (date: Date) => date };
    },
  };
}

function sessionData(): Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'> {
  return { status: 'active', metadata: {}, participants: [], schemaVersion: 1, version: 1 };
}

describe('FirestoreAdapter — deterministic ordering (#6)', () => {
  let adapter: FirestoreAdapter;

  beforeEach(() => {
    adapter = new FirestoreAdapter({
      firestore: createOrderingFirestore() as unknown as Firestore,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns messages in insertion order', async () => {
    const s = await adapter.createSession(sessionData());
    await adapter.addMessage(s.id, { role: 'user', content: 'one' });
    await adapter.addMessage(s.id, { role: 'assistant', content: 'two' });
    await adapter.addMessage(s.id, { role: 'user', content: 'three' });

    const ordered = await adapter.getMessages(s.id, { order: 'asc' });
    expect(ordered.map((m) => m.content)).toEqual(['one', 'two', 'three']);
  });

  it('keeps insertion order when timestamps collide', async () => {
    // Freeze time so all three messages share the same createdAt millisecond.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const s = await adapter.createSession(sessionData());
    await adapter.addMessage(s.id, { role: 'user', content: 'first' });
    await adapter.addMessage(s.id, { role: 'assistant', content: 'second' });
    await adapter.addMessage(s.id, { role: 'user', content: 'third' });

    const ordered = await adapter.getMessages(s.id, { order: 'asc' });
    expect(ordered.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });

  it('reverses correctly for descending order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const s = await adapter.createSession(sessionData());
    await adapter.addMessage(s.id, { role: 'user', content: 'first' });
    await adapter.addMessage(s.id, { role: 'assistant', content: 'second' });

    const ordered = await adapter.getMessages(s.id, { order: 'desc' });
    expect(ordered.map((m) => m.content)).toEqual(['second', 'first']);
  });
});
