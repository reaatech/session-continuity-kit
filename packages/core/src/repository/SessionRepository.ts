import type { Session, SessionId, Message, MessageId } from '../types/session.js';
import type { IStorageAdapter, SessionFilters, MessageQueryOptions } from '../types/storage.js';
import { ValidationError } from '../types/errors.js';

/**
 * Repository that wraps an {@link IStorageAdapter} with validation.
 * Ensures data integrity before passing to the underlying storage.
 *
 * @example
 * ```typescript
 * const repository = new SessionRepository(new MemoryAdapter());
 * const session = await repository.createSession({ ... });
 * ```
 */
export class SessionRepository {
  constructor(private storage: IStorageAdapter) {}

  /**
   * Create a new session after validating required fields.
   *
   * @param session - Complete session object
   * @returns The created session
   * @throws {ValidationError} If required fields are missing
   */
  async createSession(session: Session): Promise<Session> {
    this.validateSession(session);
    return this.storage.createSession(session);
  }

  /**
   * Get a session by ID.
   *
   * @param id - Session identifier
   * @returns The session or null if not found
   */
  async getSession(id: SessionId): Promise<Session | null> {
    return this.storage.getSession(id);
  }

  /**
   * Update a session.
   *
   * @param id - Session identifier
   * @param updates - Partial session updates
   * @returns The updated session
   */
  async updateSession(id: SessionId, updates: Partial<Session>): Promise<Session> {
    return this.storage.updateSession(id, updates);
  }

  /**
   * Delete a session.
   *
   * @param id - Session identifier
   */
  async deleteSession(id: SessionId): Promise<void> {
    await this.storage.deleteSession(id);
  }

  /**
   * List sessions with optional filters.
   *
   * @param filters - Query filters
   * @returns Array of matching sessions
   */
  async listSessions(filters?: SessionFilters): Promise<Session[]> {
    return this.storage.listSessions(filters);
  }

  /**
   * Add a message to a session after validation.
   *
   * @param sessionId - Session identifier
   * @param message - Complete message object
   * @returns The created message
   * @throws {ValidationError} If required fields are missing
   */
  async addMessage(sessionId: SessionId, message: Message): Promise<Message> {
    this.validateMessage(message);
    return this.storage.addMessage(sessionId, {
      role: message.role,
      content: message.content,
      metadata: message.metadata,
      tokenCount: message.tokenCount,
    });
  }

  /**
   * Get messages for a session.
   *
   * @param sessionId - Session identifier
   * @param options - Query options
   * @returns Array of messages
   */
  async getMessages(sessionId: SessionId, options?: MessageQueryOptions): Promise<Message[]> {
    return this.storage.getMessages(sessionId, options);
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
    return this.storage.updateMessage(sessionId, messageId, updates);
  }

  /**
   * Delete a message.
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier
   */
  async deleteMessage(sessionId: SessionId, messageId: MessageId): Promise<void> {
    await this.storage.deleteMessage(sessionId, messageId);
  }

  /**
   * Delete all messages for a session.
   *
   * @param sessionId - Session identifier
   */
  async deleteAllMessages(sessionId: SessionId): Promise<void> {
    await this.storage.deleteAllMessages(sessionId);
  }

  /**
   * Get IDs of sessions that expired before the given date.
   *
   * @param before - Cutoff date
   * @returns Array of expired session IDs
   */
  async getExpiredSessions(before: Date): Promise<SessionId[]> {
    return this.storage.getExpiredSessions(before);
  }

  /**
   * Check storage adapter health.
   *
   * @returns Health status
   */
  async health() {
    return this.storage.health();
  }

  /**
   * Close the storage connection.
   */
  async close(): Promise<void> {
    await this.storage.close();
  }

  private validateSession(session: Session): void {
    if (!session.status) {
      throw new ValidationError('Session status is required');
    }
    if (!session.metadata) {
      throw new ValidationError('Session metadata is required');
    }
  }

  private validateMessage(message: Message): void {
    if (!message.role) {
      throw new ValidationError('Message role is required');
    }
    // Allow empty string — some tool-call messages legitimately carry no textual content.
    if (message.content === undefined || message.content === null) {
      throw new ValidationError('Message content is required');
    }
  }
}
