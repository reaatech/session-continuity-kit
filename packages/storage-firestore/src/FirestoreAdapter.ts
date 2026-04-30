import type {
  Session,
  SessionId,
  Message,
  MessageId,
  IStorageAdapter,
  SessionFilters,
  MessageQueryOptions,
  HealthStatus,
} from '@reaatech/session-continuity';
import { StorageError } from '@reaatech/session-continuity';
import type { Firestore, Query } from '@google-cloud/firestore';

/**
 * Configuration for the Firestore storage adapter.
 */
export interface FirestoreAdapterConfig {
  firestore: Firestore;
  /** Field name used by Firestore TTL policy (default: 'expiresAt') */
  ttlField?: string;
}

/**
 * Firestore storage adapter using collections for sessions
 * and subcollections for messages.
 *
 * @example
 * ```typescript
 * import { Firestore } from '@google-cloud/firestore';
 * const firestore = new Firestore({ projectId: 'my-project' });
 * const adapter = new FirestoreAdapter({ firestore });
 * ```
 */
export class FirestoreAdapter implements IStorageAdapter {
  private firestore: Firestore;
  private ttlField: string;

  constructor(config: FirestoreAdapterConfig) {
    this.firestore = config.firestore;
    this.ttlField = config.ttlField ?? 'expiresAt';
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
      const docRef = this.firestore.collection('sessions').doc();
      const id = docRef.id;
      const now = new Date();

      const data = this.serializeSession({
        ...session,
        id,
        createdAt: now,
        lastActivityAt: now,
      });

      await docRef.set(data);

      return {
        ...session,
        id,
        createdAt: now,
        lastActivityAt: now,
      };
    } catch (err) {
      throw new StorageError('Failed to create session', 'firestore', err as Error);
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
      const doc = await this.firestore.collection('sessions').doc(id).get();
      if (!doc.exists) return null;
      const data = doc.data();
      if (!data) return null;
      return this.deserializeSession(data);
    } catch (err) {
      throw new StorageError('Failed to get session', 'firestore', err as Error);
    }
  }

  /**
   * Update a session.
   *
   * @param id - Session identifier
   * @param updates - Partial session updates
   * @returns The updated session
   */
  async updateSession(id: SessionId, updates: Partial<Session>): Promise<Session> {
    try {
      const docRef = this.firestore.collection('sessions').doc(id);
      const data = this.serializePartialSession(updates);
      if (Object.keys(data).length === 0) {
        const existing = await this.getSession(id);
        if (!existing) {
          throw new StorageError(`Session not found: ${id}`, 'firestore');
        }
        return existing;
      }
      await docRef.update(data);

      const updated = await docRef.get();
      const updatedData = updated.data();
      if (!updatedData) {
        throw new StorageError(`Session not found after update: ${id}`, 'firestore');
      }
      return this.deserializeSession(updatedData);
    } catch (err) {
      throw new StorageError('Failed to update session', 'firestore', err as Error);
    }
  }

  /**
   * Delete a session and all its messages.
   *
   * @param id - Session identifier
   */
  async deleteSession(id: SessionId): Promise<void> {
    try {
      const sessionRef = this.firestore.collection('sessions').doc(id);

      // Delete all messages in subcollection (chunked into batches of 500)
      const messages = await sessionRef.collection('messages').get();
      const messageDocs = messages.docs;
      const BATCH_SIZE = 500;

      for (let i = 0; i < messageDocs.length; i += BATCH_SIZE) {
        const batch = this.firestore.batch();
        const chunk = messageDocs.slice(i, i + BATCH_SIZE);
        chunk.forEach((doc) => batch.delete(doc.ref));
        if (i + BATCH_SIZE >= messageDocs.length) {
          // Last chunk: also delete the session
          batch.delete(sessionRef);
        }
        await batch.commit();
      }

      // If there were no messages, delete the session in a single batch
      if (messageDocs.length === 0) {
        const batch = this.firestore.batch();
        batch.delete(sessionRef);
        await batch.commit();
      }
    } catch (err) {
      throw new StorageError('Failed to delete session', 'firestore', err as Error);
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
      let query: Query = this.firestore.collection('sessions');

      if (filters?.userId) {
        query = query.where('userId', '==', filters.userId);
      }
      if (filters?.status) {
        query = query.where('status', '==', filters.status);
      }
      if (filters?.activeAgentId) {
        query = query.where('activeAgentId', '==', filters.activeAgentId);
      }
      if (filters?.createdAfter) {
        query = query.where('createdAt', '>=', this.toTimestamp(filters.createdAfter));
      }
      if (filters?.createdBefore) {
        query = query.where('createdAt', '<', this.toTimestamp(filters.createdBefore));
      }
      if (filters?.limit) {
        query = query.limit(filters.limit);
      }
      if (filters?.offset) {
        query = query.offset(filters.offset);
      }

      const snapshot = await query.get();
      const sessions = snapshot.docs.map((doc) => this.deserializeSession(doc.data()));

      // Client-side tag filtering (Firestore doesn't support array contains all)
      if (filters?.tags && filters.tags.length > 0) {
        const tags = filters.tags;
        return sessions.filter((s) => tags.some((tag) => s.metadata?.tags?.includes(tag)));
      }

      return sessions;
    } catch (err) {
      throw new StorageError('Failed to list sessions', 'firestore', err as Error);
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
      const docRef = this.firestore
        .collection('sessions')
        .doc(sessionId)
        .collection('messages')
        .doc();
      const id = docRef.id;
      const now = new Date();

      const data = this.serializeMessage({
        ...message,
        id,
        sessionId,
        createdAt: now,
      });

      await docRef.set(data);

      return {
        ...message,
        id,
        sessionId,
        createdAt: now,
      };
    } catch (err) {
      throw new StorageError('Failed to add message', 'firestore', err as Error);
    }
  }

  /**
   * Get messages for a session.
   *
   * @param sessionId - Session identifier
   * @param options - Query options
   * @returns Array of messages
   */
  async getMessages(sessionId: SessionId, options?: MessageQueryOptions): Promise<Message[]> {
    try {
      let query: Query = this.firestore
        .collection('sessions')
        .doc(sessionId)
        .collection('messages')
        .orderBy('createdAt', options?.order === 'desc' ? 'desc' : 'asc');

      if (options?.after) {
        query = query.where('createdAt', '>', this.toTimestamp(options.after));
      }
      if (options?.before) {
        query = query.where('createdAt', '<', this.toTimestamp(options.before));
      }
      if (options?.limit) {
        query = query.limit(options.limit);
      }
      if (options?.offset) {
        query = query.offset(options.offset);
      }

      const snapshot = await query.get();
      const messages = snapshot.docs.map((doc) => this.deserializeMessage(doc.data()));

      if (options?.roles && options.roles.length > 0) {
        const roles = options.roles;
        return messages.filter((m) => roles.includes(m.role));
      }

      return messages;
    } catch (err) {
      throw new StorageError('Failed to get messages', 'firestore', err as Error);
    }
  }

  /**
   * Update a message.
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier
   * @param updates - Partial message updates
   * @returns The updated message
   */
  async updateMessage(
    sessionId: SessionId,
    messageId: MessageId,
    updates: Partial<Message>
  ): Promise<Message> {
    try {
      const docRef = this.firestore
        .collection('sessions')
        .doc(sessionId)
        .collection('messages')
        .doc(messageId);

      const data = this.serializePartialMessage(updates);
      if (Object.keys(data).length > 0) {
        await docRef.update(data);
      }

      const updated = await docRef.get();
      const updatedData = updated.data();
      if (!updatedData) {
        throw new StorageError(`Message not found after update: ${messageId}`, 'firestore');
      }
      return this.deserializeMessage(updatedData);
    } catch (err) {
      throw new StorageError('Failed to update message', 'firestore', err as Error);
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
      await this.firestore
        .collection('sessions')
        .doc(sessionId)
        .collection('messages')
        .doc(messageId)
        .delete();
    } catch (err) {
      throw new StorageError('Failed to delete message', 'firestore', err as Error);
    }
  }

  /**
   * Delete all messages for a session.
   *
   * @param sessionId - Session identifier
   */
  async deleteAllMessages(sessionId: SessionId): Promise<void> {
    try {
      const messages = await this.firestore
        .collection('sessions')
        .doc(sessionId)
        .collection('messages')
        .get();

      const messageDocs = messages.docs;
      const BATCH_SIZE = 500;

      for (let i = 0; i < messageDocs.length; i += BATCH_SIZE) {
        const batch = this.firestore.batch();
        const chunk = messageDocs.slice(i, i + BATCH_SIZE);
        chunk.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    } catch (err) {
      throw new StorageError('Failed to delete all messages', 'firestore', err as Error);
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
      const snapshot = await this.firestore
        .collection('sessions')
        .where(this.ttlField, '<', this.toTimestamp(before))
        .get();

      return snapshot.docs.map((doc) => doc.id);
    } catch (err) {
      throw new StorageError('Failed to get expired sessions', 'firestore', err as Error);
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
      // Lightweight existence check
      await this.firestore.collection('sessions').limit(1).get();
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
   * Close the adapter. Firestore manages its own connection pool.
   */
  async close(): Promise<void> {
    // Firestore client manages its own connection pool
  }

  private serializeSession(session: Session): Record<string, unknown> {
    const { createdAt, lastActivityAt, expiresAt, participants, ...rest } = session;
    return {
      ...rest,
      participants: participants.map((p) => ({
        ...p,
        joinedAt: this.toTimestamp(p.joinedAt),
        leftAt: p.leftAt ? this.toTimestamp(p.leftAt) : null,
      })),
      createdAt: this.toTimestamp(createdAt),
      lastActivityAt: this.toTimestamp(lastActivityAt),
      expiresAt: expiresAt ? this.toTimestamp(expiresAt) : null,
      [this.ttlField]: expiresAt ? this.toTimestamp(expiresAt) : null,
    };
  }

  private serializePartialSession(updates: Partial<Session>): Record<string, unknown> {
    const data: Record<string, unknown> = { ...updates };
    if (updates.createdAt) data.createdAt = this.toTimestamp(updates.createdAt);
    if (updates.lastActivityAt) data.lastActivityAt = this.toTimestamp(updates.lastActivityAt);
    if (updates.expiresAt) {
      data.expiresAt = this.toTimestamp(updates.expiresAt);
      data[this.ttlField] = this.toTimestamp(updates.expiresAt);
    }
    if (updates.participants) {
      data.participants = updates.participants.map((p) => ({
        ...p,
        joinedAt: this.toTimestamp(p.joinedAt),
        leftAt: p.leftAt ? this.toTimestamp(p.leftAt) : null,
      }));
    }
    return data;
  }

  private deserializeSession(data: Record<string, unknown>): Session {
    return {
      ...data,
      participants: ((data.participants as Array<Record<string, unknown>>) ?? []).map((p) => ({
        ...p,
        joinedAt: this.toDate(p.joinedAt),
        leftAt: p.leftAt ? this.toDate(p.leftAt) : undefined,
      })),
      createdAt: this.toDate(data.createdAt),
      lastActivityAt: this.toDate(data.lastActivityAt),
      expiresAt: data.expiresAt ? this.toDate(data.expiresAt) : undefined,
    } as Session;
  }

  private serializeMessage(message: Message): Record<string, unknown> {
    const { createdAt, ...rest } = message;
    return {
      ...rest,
      createdAt: this.toTimestamp(createdAt),
    };
  }

  private serializePartialMessage(updates: Partial<Message>): Record<string, unknown> {
    const data: Record<string, unknown> = { ...updates };
    if (updates.createdAt) data.createdAt = this.toTimestamp(updates.createdAt);
    return data;
  }

  private deserializeMessage(data: Record<string, unknown>): Message {
    return {
      ...data,
      createdAt: this.toDate(data.createdAt),
    } as Message;
  }

  private toTimestamp(date: Date | unknown): unknown {
    if (date instanceof Date) {
      return (
        this.firestore.constructor as unknown as { Timestamp: { fromDate(d: Date): unknown } }
      ).Timestamp.fromDate(date);
    }
    return date;
  }

  private toDate(value: unknown): Date {
    if (
      value &&
      typeof value === 'object' &&
      'toDate' in value &&
      typeof (value as { toDate: () => Date }).toDate === 'function'
    ) {
      return (value as { toDate: () => Date }).toDate();
    }
    if (value instanceof Date) return value;
    return new Date(value as string);
  }
}
