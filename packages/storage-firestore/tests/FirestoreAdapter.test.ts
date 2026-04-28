import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FirestoreAdapter } from '../src/FirestoreAdapter.js';
import type { Session } from '@session-continuity-kit/core';

function createMockFirestore() {
  const docs = new Map<
    string,
    {
      data: Record<string, unknown>;
      subcollections: Map<string, Map<string, Record<string, unknown>>>;
    }
  >();

  const createDocRef = (path: string) => ({
    id: path.split('/').pop()!,
    path,
    get: vi.fn(async () => ({
      exists: docs.has(path),
      data: () => docs.get(path)?.data ?? null,
    })),
    set: vi.fn(async (data: Record<string, unknown>) => {
      docs.set(path, { data: { ...data }, subcollections: new Map() });
    }),
    update: vi.fn(async (data: Record<string, unknown>) => {
      const existing = docs.get(path);
      if (existing) {
        existing.data = { ...existing.data, ...data };
      }
    }),
    delete: vi.fn(async () => {
      docs.delete(path);
    }),
    collection: (name: string) => createCollectionRef(`${path}/${name}`),
  });

  const createCollectionRef = (path: string) => ({
    doc: vi.fn((id?: string) => {
      const docId = id ?? crypto.randomUUID();
      return createDocRef(`${path}/${docId}`);
    }),
    get: vi.fn(async () => ({
      docs: Array.from(docs.entries())
        .filter(([key]) => key.startsWith(path + '/'))
        .map(([key, value]) => ({
          id: key.split('/').pop()!,
          data: () => value.data,
          ref: createDocRef(key),
        })),
    })),
    where: vi.fn(() => createQuery(path)),
    orderBy: vi.fn(() => createQuery(path)),
    limit: vi.fn(() => createQuery(path)),
    offset: vi.fn(() => createQuery(path)),
  });

  const createQuery = (path: string) => ({
    where: vi.fn(() => createQuery(path)),
    orderBy: vi.fn(() => createQuery(path)),
    limit: vi.fn(() => createQuery(path)),
    offset: vi.fn(() => createQuery(path)),
    get: vi.fn(async () => ({
      docs: Array.from(docs.entries())
        .filter(([key]) => key.startsWith(path + '/'))
        .map(([key, value]) => ({
          id: key.split('/').pop()!,
          data: () => value.data,
          ref: createDocRef(key),
        })),
    })),
  });

  return {
    collection: vi.fn((name: string) => createCollectionRef(name)),
    batch: vi.fn(() => {
      const ops: Array<{ type: 'delete'; ref: { path: string } }> = [];
      return {
        delete: vi.fn((ref: { path: string }) => {
          ops.push({ type: 'delete', ref });
        }),
        commit: vi.fn(async () => {
          for (const op of ops) {
            docs.delete(op.ref.path);
          }
        }),
      };
    }),
    constructor: class MockFirestore {
      static Timestamp = {
        fromDate: (date: Date) => date,
      };
    },
    _docs: docs,
  };
}

describe('FirestoreAdapter', () => {
  let adapter: FirestoreAdapter;
  let mockFirestore: ReturnType<typeof createMockFirestore>;

  beforeEach(() => {
    mockFirestore = createMockFirestore();
    adapter = new FirestoreAdapter({
      firestore: mockFirestore as unknown as import('@google-cloud/firestore').Firestore,
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

  it('deletes all messages', async () => {
    const session = await adapter.createSession(createSessionData());
    await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });
    await adapter.deleteAllMessages(session.id);

    const messages = await adapter.getMessages(session.id);
    expect(messages).toHaveLength(0);
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

  it('lists sessions with tag filters', async () => {
    const s1 = await adapter.createSession({
      ...createSessionData(),
      metadata: { tags: ['important'] },
    });
    await adapter.createSession({ ...createSessionData(), metadata: { tags: ['other'] } });

    const results = await adapter.listSessions({ tags: ['important'] });
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

  it('deserializes Timestamp values', async () => {
    const timestampFirestore = createMockFirestore();
    const mockDate = new Date('2024-01-15');
    const timestampValue = {
      toDate: () => mockDate,
    };

    // Store a session with timestamp-like createdAt
    timestampFirestore._docs.set('sessions/test-session', {
      data: {
        id: 'test-session',
        status: 'active',
        metadata: {},
        participants: [],
        schemaVersion: 1,
        createdAt: timestampValue,
        lastActivityAt: timestampValue,
        expiresAt: timestampValue,
      },
      subcollections: new Map(),
    });

    const tsAdapter = new FirestoreAdapter({
      firestore: timestampFirestore as unknown as import('@google-cloud/firestore').Firestore,
    });

    const session = await tsAdapter.getSession('test-session');
    expect(session).not.toBeNull();
    expect(session!.createdAt).toEqual(mockDate);
    expect(session!.expiresAt).toEqual(mockDate);
  });

  it('returns unhealthy when firestore errors', async () => {
    const errorFirestore = createMockFirestore();
    errorFirestore.collection = vi.fn(() => {
      return {
        limit: vi.fn(() => ({
          get: vi.fn(async () => {
            throw new Error('Connection refused');
          }),
        })),
        where: vi.fn(() => ({ get: vi.fn(async () => ({ docs: [] })) })),
        orderBy: vi.fn(() => ({ get: vi.fn(async () => ({ docs: [] })) })),
        offset: vi.fn(() => ({ get: vi.fn(async () => ({ docs: [] })) })),
        doc: vi.fn(() => ({
          get: vi.fn(async () => ({ exists: false, data: () => null })),
          set: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        })),
        get: vi.fn(async () => ({ docs: [] })),
      };
    });
    const errorAdapter = new FirestoreAdapter({
      firestore: errorFirestore as unknown as import('@google-cloud/firestore').Firestore,
    });
    const health = await errorAdapter.health();
    expect(health.status).toBe('unhealthy');
  });

  it('closes without error', async () => {
    await adapter.close();
  });

  it('throws StorageError on create failure', async () => {
    const failingFirestore = createMockFirestore();
    failingFirestore.collection = vi.fn(() => {
      throw new Error('Firestore down');
    });
    const failingAdapter = new FirestoreAdapter({
      firestore: failingFirestore as unknown as import('@google-cloud/firestore').Firestore,
    });

    await expect(failingAdapter.createSession(createSessionData())).rejects.toThrow(
      'Failed to create session'
    );
  });
});
