import crypto from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionRepository } from '../src/repository/SessionRepository.js';
import { MemoryAdapter } from '../../storage-memory/src/MemoryAdapter.js';
import type { Session } from '../src/types/session.js';
import { ValidationError } from '../src/types/errors.js';

describe('SessionRepository', () => {
  let repository: SessionRepository;

  beforeEach(() => {
    const adapter = new MemoryAdapter();
    repository = new SessionRepository(adapter);
  });

  function createTestSession(): Session {
    return {
      id: crypto.randomUUID(),
      status: 'active',
      metadata: {},
      participants: [],
      schemaVersion: 1,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };
  }

  it('creates and retrieves a session', async () => {
    const session = createTestSession();
    const created = await repository.createSession(session);
    expect(created.id).toBe(session.id);

    const retrieved = await repository.getSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(session.id);
  });

  it('returns null for non-existent session', async () => {
    const result = await repository.getSession('non-existent');
    expect(result).toBeNull();
  });

  it('updates a session', async () => {
    const session = createTestSession();
    await repository.createSession(session);

    const updated = await repository.updateSession(session.id, { status: 'completed' });
    expect(updated.status).toBe('completed');
  });

  it('deletes a session', async () => {
    const session = createTestSession();
    await repository.createSession(session);
    await repository.deleteSession(session.id);

    const retrieved = await repository.getSession(session.id);
    expect(retrieved).toBeNull();
  });

  it('lists sessions with filters', async () => {
    const session1 = createTestSession();
    const session2 = createTestSession();
    session2.userId = 'user-123';

    await repository.createSession(session1);
    await repository.createSession(session2);

    const results = await repository.listSessions({ userId: 'user-123' });
    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe('user-123');
  });

  it('validates session on create', async () => {
    const invalidSession = {
      ...createTestSession(),
      status: undefined as unknown as Session['status'],
    };
    await expect(repository.createSession(invalidSession as Session)).rejects.toThrow(
      ValidationError
    );
  });

  it('adds and retrieves messages', async () => {
    const session = createTestSession();
    await repository.createSession(session);

    const message = await repository.addMessage(session.id, {
      id: crypto.randomUUID(),
      sessionId: session.id,
      role: 'user',
      content: 'Hello',
      createdAt: new Date(),
    });

    expect(message.content).toBe('Hello');

    const messages = await repository.getMessages(session.id);
    expect(messages).toHaveLength(1);
  });

  it('returns healthy status', async () => {
    const health = await repository.health();
    expect(health.status).toBe('healthy');
  });

  it('updates a message', async () => {
    const session = createTestSession();
    await repository.createSession(session);

    const message = await repository.addMessage(session.id, {
      id: crypto.randomUUID(),
      sessionId: session.id,
      role: 'user',
      content: 'Hello',
      createdAt: new Date(),
    });

    const updated = await repository.updateMessage(session.id, message.id, { content: 'Updated' });
    expect(updated.content).toBe('Updated');
  });

  it('deletes a message', async () => {
    const session = createTestSession();
    await repository.createSession(session);

    const message = await repository.addMessage(session.id, {
      id: crypto.randomUUID(),
      sessionId: session.id,
      role: 'user',
      content: 'Hello',
      createdAt: new Date(),
    });

    await repository.deleteMessage(session.id, message.id);
    const messages = await repository.getMessages(session.id);
    expect(messages).toHaveLength(0);
  });

  it('deletes all messages', async () => {
    const session = createTestSession();
    await repository.createSession(session);

    await repository.addMessage(session.id, {
      id: crypto.randomUUID(),
      sessionId: session.id,
      role: 'user',
      content: 'Hello',
      createdAt: new Date(),
    });

    await repository.deleteAllMessages(session.id);
    const messages = await repository.getMessages(session.id);
    expect(messages).toHaveLength(0);
  });

  it('returns expired sessions', async () => {
    const session = createTestSession();
    session.expiresAt = new Date(Date.now() - 1000);
    await repository.createSession(session);

    const expired = await repository.getExpiredSessions(new Date());
    expect(expired).toContain(session.id);
  });

  it('closes storage adapter', async () => {
    await repository.close();
    // Should not throw
  });

  it('validates message content is required', async () => {
    const session = createTestSession();
    await repository.createSession(session);

    await expect(
      repository.addMessage(session.id, {
        id: crypto.randomUUID(),
        sessionId: session.id,
        role: 'user',
        content: undefined as any,
        createdAt: new Date(),
      })
    ).rejects.toThrow('Message content is required');
  });

  it('validates message role is required', async () => {
    const session = createTestSession();
    await repository.createSession(session);

    await expect(
      repository.addMessage(session.id, {
        id: crypto.randomUUID(),
        sessionId: session.id,
        role: undefined as any,
        content: 'Hello',
        createdAt: new Date(),
      })
    ).rejects.toThrow('Message role is required');
  });
});
