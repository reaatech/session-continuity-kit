import crypto from 'node:crypto';
import type {
  Session,
  SessionId,
  Message,
  MessageId,
  IStorageAdapter,
  SessionFilters,
  MessageQueryOptions,
  UpdateSessionOptions,
  HealthStatus,
} from '@reaatech/session-continuity';
import { StorageError, ConcurrencyError } from '@reaatech/session-continuity';
import type { RedisClientType } from 'redis';

/**
 * Configuration for the Redis storage adapter.
 */
export interface RedisAdapterConfig {
  client: RedisClientType;
  /** Default TTL in seconds */
  ttlSeconds?: number;
}

/**
 * Redis storage adapter using hashes for sessions, sorted sets for messages,
 * and sets for user indexes.
 *
 * @example
 * ```typescript
 * import { createClient } from 'redis';
 * const client = createClient({ url: 'redis://localhost:6379' });
 * const adapter = new RedisAdapter({ client, ttlSeconds: 3600 });
 * ```
 */
export class RedisAdapter implements IStorageAdapter {
  private client: RedisClientType;
  private ttlSeconds?: number;

  constructor(config: RedisAdapterConfig) {
    this.client = config.client;
    this.ttlSeconds = config.ttlSeconds;
  }

  /**
   * Create a new session.
   *
   * @param session - Session data
   * @returns The created session
   */
  async createSession(
    session: Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'>
  ): Promise<Session> {
    try {
      const id = crypto.randomUUID();
      const now = new Date();
      const created: Session = {
        ...session,
        id,
        createdAt: now,
        lastActivityAt: now,
      };

      const sessionKey = `session:${id}`;
      await this.client.hSet(sessionKey, this.serializeSession(created));

      if (this.ttlSeconds) {
        await this.client.expire(sessionKey, this.ttlSeconds);
      }

      // Maintain user index if userId present
      if (created.userId) {
        await this.client.sAdd(`user:${created.userId}:sessions`, id);
      }

      return created;
    } catch (err) {
      throw new StorageError('Failed to create session', 'redis', err as Error);
    }
  }

  /**
   * Get a session by ID.
   *
   * @param id - Session identifier
   * @returns The session or null if not found
   */
  async getSession(id: SessionId): Promise<Session | null> {
    try {
      const sessionKey = `session:${id}`;
      const data = await this.client.hGetAll(sessionKey);
      if (!data || Object.keys(data).length === 0) return null;
      return this.deserializeSession(data);
    } catch (err) {
      throw new StorageError('Failed to get session', 'redis', err as Error);
    }
  }

  /**
   * Update a session.
   *
   * @param id - Session identifier
   * @param updates - Partial session updates
   * @param options.expectedVersion - When provided, the rewrite runs under a
   * `WATCH`/`MULTI`/`EXEC` optimistic transaction: the stored `version` is
   * re-checked and a concurrent change rejects the write with
   * {@link ConcurrencyError}.
   * @returns The updated session
   * @throws {StorageError} If session does not exist
   */
  async updateSession(
    id: SessionId,
    updates: Partial<Session>,
    options?: UpdateSessionOptions
  ): Promise<Session> {
    const expectedVersion = options?.expectedVersion;
    const sessionKey = `session:${id}`;

    if (expectedVersion !== undefined) {
      try {
        // Optimistic lock: WATCH first so EXEC aborts if the key changes under us.
        await this.client.watch(sessionKey);
        const existing = await this.getSession(id);
        if (!existing) {
          await this.client.unwatch();
          throw new StorageError(`Session not found: ${id}`, 'redis');
        }
        const actual = existing.version ?? 0;
        if (actual !== expectedVersion) {
          await this.client.unwatch();
          throw new ConcurrencyError(id, expectedVersion, actual);
        }

        const updated = { ...existing, ...updates };
        const multi = this.client.multi();
        multi.del(sessionKey);
        multi.hSet(sessionKey, this.serializeSession(updated));
        if (this.ttlSeconds) {
          multi.expire(sessionKey, this.ttlSeconds);
        }
        const result = await multi.exec();
        // node-redis returns null when a watched key was modified mid-transaction.
        if (result === null) {
          throw new ConcurrencyError(id, expectedVersion, actual);
        }

        await this.reindexUser(id, existing, updates);
        return updated;
      } catch (err) {
        if (err instanceof ConcurrencyError) throw err;
        throw new StorageError('Failed to update session', 'redis', err as Error);
      }
    }

    try {
      const existing = await this.getSession(id);
      if (!existing) {
        throw new StorageError(`Session not found: ${id}`, 'redis');
      }

      const updated = { ...existing, ...updates };
      // Rebuild the hash so removed optional fields are properly cleared
      await this.client.del(sessionKey);
      await this.client.hSet(sessionKey, this.serializeSession(updated));

      if (this.ttlSeconds) {
        await this.client.expire(sessionKey, this.ttlSeconds);
      }

      await this.reindexUser(id, existing, updates);

      return updated;
    } catch (err) {
      throw new StorageError('Failed to update session', 'redis', err as Error);
    }
  }

  /** Keep the user→sessions index in sync when a session's userId changes. */
  private async reindexUser(
    id: SessionId,
    existing: Session,
    updates: Partial<Session>
  ): Promise<void> {
    if (updates.userId !== undefined && updates.userId !== existing.userId) {
      if (existing.userId) {
        await this.client.sRem(`user:${existing.userId}:sessions`, id);
      }
      if (updates.userId) {
        await this.client.sAdd(`user:${updates.userId}:sessions`, id);
      }
    }
  }

  /**
   * Delete a session and all its messages.
   *
   * @param id - Session identifier
   */
  async deleteSession(id: SessionId): Promise<void> {
    try {
      const session = await this.getSession(id);
      if (session?.userId) {
        await this.client.sRem(`user:${session.userId}:sessions`, id);
      }

      // Delete all messages
      await this.deleteAllMessages(id);

      // Delete session hash and the message-sequence counter
      await this.client.del(`session:${id}`);
      await this.client.del(`session:${id}:seq`);
    } catch (err) {
      throw new StorageError('Failed to delete session', 'redis', err as Error);
    }
  }

  /**
   * List sessions with optional filters.
   *
   * @remarks Tag filtering uses OR semantics (matches if any tag is present).
   * @param filters - Query filters
   * @returns Array of matching sessions
   */
  async listSessions(filters?: SessionFilters): Promise<Session[]> {
    try {
      const sessions: Session[] = [];

      // Best-effort: if userId filter provided and no other filters, use index
      if (filters?.userId && !filters.status && !filters.activeAgentId && !filters.tags) {
        const ids = await this.client.sMembers(`user:${filters.userId}:sessions`);
        for (const id of ids) {
          const session = await this.getSession(id);
          if (session) sessions.push(session);
        }
      } else {
        // Fallback to SCAN with client-side filtering
        let cursor = 0;
        do {
          const result = await this.client.scan(String(cursor), {
            MATCH: 'session:*',
            COUNT: 100,
          });
          cursor = Number(result.cursor);

          for (const key of result.keys) {
            // Skip message keys
            if (key.includes(':messages')) continue;
            const id = key.replace('session:', '');
            const session = await this.getSession(id);
            if (session) sessions.push(session);
          }
        } while (cursor !== 0);
      }

      // Apply client-side filters
      const results = sessions.filter((s) => this.matchesFilters(s, filters));

      const offset = filters?.offset ?? 0;
      const limit = filters?.limit ?? results.length;
      return results.slice(offset, offset + limit);
    } catch (err) {
      throw new StorageError('Failed to list sessions', 'redis', err as Error);
    }
  }

  /**
   * Add a message to a session.
   *
   * @param sessionId - Session identifier
   * @param message - Message data
   * @returns The created message
   */
  async addMessage(
    sessionId: SessionId,
    message: Omit<Message, 'id' | 'sessionId' | 'createdAt'>
  ): Promise<Message> {
    try {
      const id = crypto.randomUUID();
      const now = new Date();

      // Monotonic per-session sequence via an atomic counter. Scoring the sorted
      // set by sequence (not timestamp) gives a deterministic, gap-free insertion
      // order even when messages land in the same millisecond.
      const seqKey = `session:${sessionId}:seq`;
      const sequence = message.sequence ?? Number(await this.client.incr(seqKey));

      const created: Message = {
        ...message,
        id,
        sessionId,
        sequence,
        createdAt: now,
      };

      const messagesKey = `session:${sessionId}:messages`;
      const messageKey = `message:${id}`;

      // Add to sorted set (score = sequence)
      await this.client.zAdd(messagesKey, {
        score: sequence,
        value: id,
      });

      // Store message data
      await this.client.hSet(messageKey, this.serializeMessage(created));

      // Set TTL on message, sorted set, and the sequence counter if session has TTL
      if (this.ttlSeconds) {
        await this.client.expire(messageKey, this.ttlSeconds);
        await this.client.expire(messagesKey, this.ttlSeconds);
        await this.client.expire(seqKey, this.ttlSeconds);
      }

      return created;
    } catch (err) {
      throw new StorageError('Failed to add message', 'redis', err as Error);
    }
  }

  /**
   * Get messages for a session.
   *
   * @remarks The `after` and `before` query options are not supported by this adapter.
   *   `limit` is applied before role filtering, so results may be fewer than requested.
   * @param sessionId - Session identifier
   * @param options - Query options
   * @returns Array of messages
   */
  async getMessages(sessionId: SessionId, options?: MessageQueryOptions): Promise<Message[]> {
    try {
      const messagesKey = `session:${sessionId}:messages`;
      const start = options?.offset ?? 0;
      const stop = options?.limit ? start + options.limit - 1 : -1;

      const ids =
        options?.order === 'desc'
          ? await this.client.zRange(messagesKey, start, stop, { REV: true })
          : await this.client.zRange(messagesKey, start, stop);

      const messages: Message[] = [];
      for (const id of ids) {
        const data = await this.client.hGetAll(`message:${id}`);
        if (data && Object.keys(data).length > 0) {
          messages.push(this.deserializeMessage(data));
        }
      }

      if (options?.roles && options.roles.length > 0) {
        const roles = options.roles;
        return messages.filter((m) => roles.includes(m.role));
      }

      return messages;
    } catch (err) {
      throw new StorageError('Failed to get messages', 'redis', err as Error);
    }
  }

  /**
   * Update a message.
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier
   * @param updates - Partial message updates
   * @returns The updated message
   * @throws {StorageError} If message does not exist
   */
  async updateMessage(
    sessionId: SessionId,
    messageId: MessageId,
    updates: Partial<Message>
  ): Promise<Message> {
    try {
      const messageKey = `message:${messageId}`;
      const existing = await this.client.hGetAll(messageKey);
      if (!existing || Object.keys(existing).length === 0) {
        throw new StorageError(`Message not found: ${messageId}`, 'redis');
      }

      const message = this.deserializeMessage(existing);
      const updated = { ...message, ...updates };
      await this.client.hSet(messageKey, this.serializeMessage(updated));

      return updated;
    } catch (err) {
      throw new StorageError('Failed to update message', 'redis', err as Error);
    }
  }

  /**
   * Delete a message.
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier
   */
  async deleteMessage(sessionId: SessionId, messageId: MessageId): Promise<void> {
    try {
      const messagesKey = `session:${sessionId}:messages`;
      await this.client.zRem(messagesKey, messageId);
      await this.client.del(`message:${messageId}`);
    } catch (err) {
      throw new StorageError('Failed to delete message', 'redis', err as Error);
    }
  }

  /**
   * Delete all messages for a session.
   *
   * @param sessionId - Session identifier
   */
  async deleteAllMessages(sessionId: SessionId): Promise<void> {
    try {
      const messagesKey = `session:${sessionId}:messages`;
      const ids = await this.client.zRange(messagesKey, 0, -1);

      const pipeline = this.client.multi();
      for (const id of ids) {
        pipeline.del(`message:${id}`);
      }
      pipeline.del(messagesKey);
      await pipeline.exec();
    } catch (err) {
      throw new StorageError('Failed to delete all messages', 'redis', err as Error);
    }
  }

  /**
   * Get expired session IDs.
   *
   * @param before - Cutoff date
   * @returns Array of expired session IDs
   */
  async getExpiredSessions(before: Date): Promise<SessionId[]> {
    try {
      // Redis doesn't have a native way to query by TTL.
      // We scan sessions and check expiresAt field.
      const expired: SessionId[] = [];
      let cursor = 0;

      do {
        const result = await this.client.scan(String(cursor), {
          MATCH: 'session:*',
          COUNT: 100,
        });
        cursor = Number(result.cursor);

        for (const key of result.keys) {
          if (key.includes(':messages')) continue;
          const id = key.replace('session:', '');
          const data = await this.client.hGetAll(key);
          if (data.expiresAt) {
            const expiresAt = new Date(data.expiresAt);
            if (expiresAt <= before) {
              expired.push(id);
            }
          }
        }
      } while (cursor !== 0);

      return expired;
    } catch (err) {
      throw new StorageError('Failed to get expired sessions', 'redis', err as Error);
    }
  }

  /**
   * Health check.
   *
   * @returns Health status
   */
  async health(): Promise<HealthStatus> {
    try {
      const start = Date.now();
      await this.client.ping();
      return {
        status: 'healthy',
        latency: Date.now() - start,
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        details: { error: (err as Error).message },
      };
    }
  }

  /**
   * Close the Redis connection.
   */
  async close(): Promise<void> {
    await this.client.quit();
  }

  private serializeSession(session: Session): Record<string, string> {
    const data: Record<string, string> = {
      id: session.id,
      status: session.status,
      metadata: JSON.stringify(session.metadata),
      participants: JSON.stringify(session.participants),
      schemaVersion: String(session.schemaVersion),
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      version: String(session.version ?? 1),
    };

    if (session.userId !== undefined) data.userId = session.userId;
    if (session.activeAgentId !== undefined) data.activeAgentId = session.activeAgentId;
    if (session.expiresAt) data.expiresAt = session.expiresAt.toISOString();
    if (session.tokenBudget) data.tokenBudget = JSON.stringify(session.tokenBudget);
    if (session.compression) data.compression = JSON.stringify(session.compression);

    return data;
  }

  private deserializeSession(data: Record<string, string>): Session {
    return {
      id: data.id,
      userId: data.userId ?? undefined,
      activeAgentId: data.activeAgentId ?? undefined,
      status: data.status as Session['status'],
      metadata: data.metadata ? JSON.parse(data.metadata) : {},
      participants: data.participants ? JSON.parse(data.participants) : [],
      schemaVersion: Number(data.schemaVersion),
      createdAt: new Date(data.createdAt),
      lastActivityAt: new Date(data.lastActivityAt),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      tokenBudget: data.tokenBudget ? JSON.parse(data.tokenBudget) : undefined,
      compression: data.compression ? JSON.parse(data.compression) : undefined,
      version: Number(data.version ?? 1),
    };
  }

  private serializeMessage(message: Message): Record<string, string> {
    const isStructured = typeof message.content !== 'string';
    return {
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: isStructured ? JSON.stringify(message.content) : (message.content as string),
      // Explicit marker so deserialize doesn't have to sniff the payload.
      // Avoids corrupting plain-text messages that happen to start with '['.
      contentType: isStructured ? 'json' : 'string',
      tokenCount: String(message.tokenCount ?? ''),
      sequence: String(message.sequence ?? ''),
      metadata: message.metadata ? JSON.stringify(message.metadata) : '',
      createdAt: message.createdAt.toISOString(),
    };
  }

  private deserializeMessage(data: Record<string, string>): Message {
    const content: Message['content'] =
      data.contentType === 'json' ? JSON.parse(data.content) : data.content;

    return {
      id: data.id,
      sessionId: data.sessionId,
      role: data.role as Message['role'],
      content,
      tokenCount: data.tokenCount ? Number(data.tokenCount) : undefined,
      sequence: data.sequence ? Number(data.sequence) : undefined,
      metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
      createdAt: new Date(data.createdAt),
    };
  }

  private matchesFilters(session: Session, filters?: SessionFilters): boolean {
    if (!filters) return true;
    if (filters.status && session.status !== filters.status) return false;
    if (filters.userId && session.userId !== filters.userId) return false;
    if (filters.activeAgentId && session.activeAgentId !== filters.activeAgentId) return false;
    if (filters.createdAfter && session.createdAt < filters.createdAfter) return false;
    if (filters.createdBefore && session.createdAt > filters.createdBefore) return false;
    if (filters.tags && filters.tags.length > 0) {
      if (!filters.tags.some((tag) => session.metadata?.tags?.includes(tag))) return false;
    }
    return true;
  }
}
