import type { Session, SessionId, SessionStatus } from './session.js';
import type { Message, MessageId, MessageRole } from './session.js';

/** Storage adapter interface */
export interface IStorageAdapter {
  /**
   * Create a new session
   */
  createSession(session: Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'>): Promise<Session>;

  /**
   * Get a session by ID
   */
  getSession(id: SessionId): Promise<Session | null>;

  /**
   * Update a session
   */
  updateSession(id: SessionId, updates: Partial<Session>): Promise<Session>;

  /**
   * Delete a session
   */
  deleteSession(id: SessionId): Promise<void>;

  /**
   * List sessions with optional filters
   */
  listSessions(filters?: SessionFilters): Promise<Session[]>;

  /**
   * Add a message to a session
   */
  addMessage(
    sessionId: SessionId,
    message: Omit<Message, 'id' | 'sessionId' | 'createdAt'>
  ): Promise<Message>;

  /**
   * Get messages for a session
   */
  getMessages(sessionId: SessionId, options?: MessageQueryOptions): Promise<Message[]>;

  /**
   * Update a message
   */
  updateMessage(
    sessionId: SessionId,
    messageId: MessageId,
    updates: Partial<Message>
  ): Promise<Message>;

  /**
   * Delete a message
   */
  deleteMessage(sessionId: SessionId, messageId: MessageId): Promise<void>;

  /**
   * Delete all messages for a session
   */
  deleteAllMessages(sessionId: SessionId): Promise<void>;

  /**
   * Get expired sessions (for cleanup)
   */
  getExpiredSessions(before: Date): Promise<SessionId[]>;

  /**
   * Health check
   */
  health(): Promise<HealthStatus>;

  /**
   * Close connection
   */
  close(): Promise<void>;
}

export interface SessionFilters {
  userId?: string;
  status?: SessionStatus;
  activeAgentId?: string;
  tags?: string[];
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

export interface MessageQueryOptions {
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
  after?: Date;
  before?: Date;
  roles?: MessageRole[];
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency?: number;
  details?: Record<string, unknown>;
}
