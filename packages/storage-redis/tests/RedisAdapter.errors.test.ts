import { describe, it, expect, vi } from 'vitest';
import { RedisAdapter } from '../src/RedisAdapter.js';
import type { Session } from '@session-continuity-kit/core';

function createFailingClient() {
  const error = new Error('Redis down');
  return {
    hSet: vi.fn(async () => {
      throw error;
    }),
    hGetAll: vi.fn(async () => {
      throw error;
    }),
    del: vi.fn(async () => {
      throw error;
    }),
    zAdd: vi.fn(async () => {
      throw error;
    }),
    zRange: vi.fn(async () => {
      throw error;
    }),
    zRevRange: vi.fn(async () => {
      throw error;
    }),
    zRem: vi.fn(async () => {
      throw error;
    }),
    sAdd: vi.fn(async () => {
      throw error;
    }),
    sRem: vi.fn(async () => {
      throw error;
    }),
    sMembers: vi.fn(async () => {
      throw error;
    }),
    expire: vi.fn(async () => {
      throw error;
    }),
    scan: vi.fn(async () => {
      throw error;
    }),
    ping: vi.fn(async () => {
      throw error;
    }),
    multi: vi.fn(() => ({
      del: vi.fn(function () {
        return this;
      }),
      exec: vi.fn(async () => {
        throw error;
      }),
    })),
    quit: vi.fn(async () => {
      throw error;
    }),
  };
}

function createSessionData(): Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'> {
  return { status: 'active', metadata: {}, participants: [], schemaVersion: 1 };
}

describe('RedisAdapter error handling', () => {
  function createAdapter() {
    return new RedisAdapter({
      client: createFailingClient() as unknown as import('redis').RedisClientType,
    });
  }

  it('throws on createSession', async () => {
    await expect(createAdapter().createSession(createSessionData())).rejects.toThrow(
      'Failed to create session'
    );
  });

  it('throws on getSession', async () => {
    await expect(createAdapter().getSession('123')).rejects.toThrow('Failed to get session');
  });

  it('throws on updateSession', async () => {
    await expect(createAdapter().updateSession('123', { status: 'completed' })).rejects.toThrow(
      'Failed to update session'
    );
  });

  it('throws on deleteSession', async () => {
    await expect(createAdapter().deleteSession('123')).rejects.toThrow('Failed to delete session');
  });

  it('throws on listSessions', async () => {
    await expect(createAdapter().listSessions()).rejects.toThrow('Failed to list sessions');
  });

  it('throws on addMessage', async () => {
    await expect(
      createAdapter().addMessage('123', { role: 'user', content: 'hi' })
    ).rejects.toThrow('Failed to add message');
  });

  it('throws on getMessages', async () => {
    await expect(createAdapter().getMessages('123')).rejects.toThrow('Failed to get messages');
  });

  it('throws on updateMessage', async () => {
    await expect(createAdapter().updateMessage('123', 'msg-1', { content: 'x' })).rejects.toThrow(
      'Failed to update message'
    );
  });

  it('throws on deleteMessage', async () => {
    await expect(createAdapter().deleteMessage('123', 'msg-1')).rejects.toThrow(
      'Failed to delete message'
    );
  });

  it('throws on deleteAllMessages', async () => {
    await expect(createAdapter().deleteAllMessages('123')).rejects.toThrow(
      'Failed to delete all messages'
    );
  });

  it('throws on getExpiredSessions', async () => {
    await expect(createAdapter().getExpiredSessions(new Date())).rejects.toThrow(
      'Failed to get expired sessions'
    );
  });

  it('returns unhealthy on health check', async () => {
    const health = await createAdapter().health();
    expect(health.status).toBe('unhealthy');
  });
});
