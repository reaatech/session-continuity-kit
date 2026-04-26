import { randomUUID } from 'crypto';
import type {
  Session,
  SessionId,
  Message,
  MessageId,
  IStorageAdapter,
  SessionFilters,
  MessageQueryOptions,
  HealthStatus,
} from '@session-continuity-kit/core';
import { StorageError } from '@session-continuity-kit/core';

/**
 * Configuration for the in-memory storage adapter.
 */
export interface MemoryAdapterConfig {
  /** Simulate TTL in milliseconds (default: no TTL) */
  ttlMs?: number;
}

/**
 * In-memory storage adapter for development and testing.
 * Stores sessions and messages in JavaScript Maps.
 * Optionally simulates TTL with setTimeout.
 *
 * @example
 * ```typescript
 * const adapter = new MemoryAdapter({ ttlMs: 3600000 });
 * const session = await adapter.createSession({ status: 'active', metadata: {} });
 * ```
 */
export class MemoryAdapter implements IStorageAdapter {
  private sessions: Map<SessionId, Session> = new Map();
  private messages: Map<SessionId, Map<MessageId, Message>> = new Map();
  private ttlTimers: Map<SessionId, ReturnType<typeof setTimeout>> = new Map();

  constructor(private config: MemoryAdapterConfig = {}) {}

  /**
   * Create a new session.
   *
   * @param session - Session data (without id, createdAt, lastActivityAt)
   * @returns The created session
   */
  async createSession(
    session: Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'>
  ): Promise<Session> {
    const id = (session as unknown as { id?: string }).id ?? randomUUID();
    const now = new Date();
    const created: Session = {
      ...session,
      id,
      createdAt: now,
      lastActivityAt: now,
    };

    // Compute expiresAt from ttlMs if not provided
    if (!created.expiresAt && this.config.ttlMs && this.config.ttlMs > 0) {
      created.expiresAt = new Date(now.getTime() + this.config.ttlMs);
    }

    this.sessions.set(id, created);

    if (this.config.ttlMs && this.config.ttlMs > 0) {
      this.scheduleExpiry(id, this.config.ttlMs);
    }

    return created;
  }

  /**
   * Get a session by ID.
   *
   * @param id - Session identifier
   * @returns The session or null if not found
   */
  async getSession(id: SessionId): Promise<Session | null> {
    return this.sessions.get(id) ?? null;
  }

  /**
   * Update a session.
   *
   * @param id - Session identifier
   * @param updates - Partial session updates
   * @returns The updated session
   * @throws {StorageError} If session does not exist
   */
  async updateSession(id: SessionId, updates: Partial<Session>): Promise<Session> {
    const existing = this.sessions.get(id);
    if (!existing) {
      throw new StorageError(`Session not found: ${id}`, 'memory');
    }

    const updated = { ...existing, ...updates };
    this.sessions.set(id, updated);

    // Reset TTL timer if TTL is configured
    if (this.config.ttlMs && this.config.ttlMs > 0) {
      this.clearExpiry(id);
      this.scheduleExpiry(id, this.config.ttlMs);
    }

    return updated;
  }

  /**
   * Delete a session and all its messages.
   *
   * @param id - Session identifier
   */
  async deleteSession(id: SessionId): Promise<void> {
    this.sessions.delete(id);
    this.messages.delete(id);
    this.clearExpiry(id);
  }

  /**
   * List sessions with optional filters.
   *
   * @remarks Tag filtering uses OR semantics (matches if any tag is present).
   * @param filters - Query filters
   * @returns Array of matching sessions
   */
  async listSessions(filters?: SessionFilters): Promise<Session[]> {
    let results = Array.from(this.sessions.values());

    if (filters?.userId) {
      results = results.filter((s) => s.userId === filters.userId);
    }
    if (filters?.status) {
      results = results.filter((s) => s.status === filters.status);
    }
    if (filters?.activeAgentId) {
      results = results.filter((s) => s.activeAgentId === filters.activeAgentId);
    }
    if (filters?.tags && filters.tags.length > 0) {
      const tags = filters.tags;
      results = results.filter((s) => tags.some((tag: string) => s.metadata?.tags?.includes(tag)));
    }
    if (filters?.createdAfter) {
      const after = filters.createdAfter;
      results = results.filter((s) => s.createdAt >= after);
    }
    if (filters?.createdBefore) {
      const before = filters.createdBefore;
      results = results.filter((s) => s.createdAt <= before);
    }

    // Apply offset and limit
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? results.length;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Add a message to a session.
   *
   * @param sessionId - Session identifier
   * @param message - Message data (without id, sessionId, createdAt)
   * @returns The created message
   */
  async addMessage(
    sessionId: SessionId,
    message: Omit<Message, 'id' | 'sessionId' | 'createdAt'>
  ): Promise<Message> {
    const id = randomUUID();
    const created: Message = {
      ...message,
      id,
      sessionId,
      createdAt: new Date(),
    };

    if (!this.messages.has(sessionId)) {
      this.messages.set(sessionId, new Map());
    }
    this.messages.get(sessionId)!.set(id, created);

    return created;
  }

  /**
   * Get messages for a session with optional query options.
   *
   * @param sessionId - Session identifier
   * @param options - Query options
   * @returns Array of messages
   */
  async getMessages(sessionId: SessionId, options?: MessageQueryOptions): Promise<Message[]> {
    const sessionMessages = this.messages.get(sessionId);
    if (!sessionMessages) return [];

    let results = Array.from(sessionMessages.values());

    if (options?.roles && options.roles.length > 0) {
      const roles = options.roles;
      results = results.filter((m) => roles.includes(m.role));
    }
    if (options?.after) {
      const after = options.after;
      results = results.filter((m) => m.createdAt > after);
    }
    if (options?.before) {
      const before = options.before;
      results = results.filter((m) => m.createdAt < before);
    }

    // Sort by createdAt
    results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    if (options?.order === 'desc') {
      results.reverse();
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Update a message.
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier
   * @param updates - Partial message updates
   * @returns The updated message
   * @throws {StorageError} If session or message does not exist
   */
  async updateMessage(
    sessionId: SessionId,
    messageId: MessageId,
    updates: Partial<Message>
  ): Promise<Message> {
    const sessionMessages = this.messages.get(sessionId);
    if (!sessionMessages) {
      throw new StorageError(`Session not found: ${sessionId}`, 'memory');
    }

    const existing = sessionMessages.get(messageId);
    if (!existing) {
      throw new StorageError(`Message not found: ${messageId}`, 'memory');
    }

    const updated = { ...existing, ...updates };
    sessionMessages.set(messageId, updated);
    return updated;
  }

  /**
   * Delete a message.
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier
   */
  async deleteMessage(sessionId: SessionId, messageId: MessageId): Promise<void> {
    this.messages.get(sessionId)?.delete(messageId);
  }

  /**
   * Delete all messages for a session.
   *
   * @param sessionId - Session identifier
   */
  async deleteAllMessages(sessionId: SessionId): Promise<void> {
    this.messages.delete(sessionId);
  }

  /**
   * Get expired session IDs.
   *
   * @param before - Cutoff date
   * @returns Array of expired session IDs
   */
  async getExpiredSessions(before: Date): Promise<SessionId[]> {
    const expired: SessionId[] = [];
    for (const [id, session] of this.sessions) {
      if (session.expiresAt && session.expiresAt <= before) {
        expired.push(id);
      }
    }
    return expired;
  }

  /**
   * Health check.
   *
   * @returns Health status
   */
  async health(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      latency: 0,
    };
  }

  /**
   * Clear all data and timers.
   */
  async close(): Promise<void> {
    this.sessions.clear();
    this.messages.clear();
    for (const timer of this.ttlTimers.values()) {
      clearTimeout(timer);
    }
    this.ttlTimers.clear();
  }

  private scheduleExpiry(id: SessionId, ttlMs: number): void {
    const timer = setTimeout(() => {
      this.sessions.delete(id);
      this.messages.delete(id);
      this.ttlTimers.delete(id);
    }, ttlMs);
    // Allow the Node process to exit even while a TTL timer is pending.
    // `.unref` is a no-op in non-Node runtimes, so guard the call.
    (timer as { unref?: () => void }).unref?.();
    this.ttlTimers.set(id, timer);
  }

  private clearExpiry(id: SessionId): void {
    const timer = this.ttlTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.ttlTimers.delete(id);
    }
  }
}
