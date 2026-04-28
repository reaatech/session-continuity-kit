import type {
  Session,
  SessionId,
  Message,
  Participant,
  MessageMetadata,
  MessageContent,
} from '../types/session.js';
import type {
  CreateSessionOptions,
  CreateMessageOptions,
  CreateParticipantOptions,
  HandoffContext,
  SessionManagerConfig,
} from '../types/config.js';
import type { MessageQueryOptions } from '../types/storage.js';
import type {
  CompressionResult,
  CompressionConfig,
  CompressionStrategyType,
  ICompressionStrategy,
} from '../types/compression.js';
import type { Logger } from '../types/config.js';
import type { HealthStatus } from '../types/storage.js';
import type { EventHandler, SessionEvent, SessionEventPayload } from '../types/events.js';
import {
  SessionNotFoundError,
  ValidationError,
  TokenBudgetExceededError,
  HandoffError,
} from '../types/errors.js';
import { randomUUID } from 'node:crypto';
import { SessionEventEmitter } from '../events/SessionEventEmitter.js';
import { SessionRepository } from '../repository/SessionRepository.js';
import { MessageWindow } from './MessageWindow.js';
import { TokenBudget } from './TokenBudget.js';
import { SlidingWindowStrategy } from '../compression/SlidingWindowStrategy.js';
import { SummarizationStrategy } from '../compression/SummarizationStrategy.js';
import { HybridStrategy } from '../compression/HybridStrategy.js';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Main entry point for session management operations.
 * Coordinates session lifecycle, messages, compression, participants,
 * agent handoffs, and event emission.
 *
 * @example
 * ```typescript
 * const manager = new SessionManager({
 *   storage: new MemoryAdapter(),
 *   tokenCounter: new TiktokenTokenizer('gpt-4'),
 *   tokenBudget: { maxTokens: 4096, reserveTokens: 500, overflowStrategy: 'compress' },
 *   compression: { strategy: 'sliding_window', targetTokens: 3500 }
 * });
 *
 * const session = await manager.createSession({ userId: 'user-123' });
 * await manager.addMessage(session.id, { role: 'user', content: 'Hello!' });
 * const context = await manager.getConversationContext(session.id);
 * ```
 */
export class SessionManager {
  private repository: SessionRepository;
  private eventEmitter: SessionEventEmitter;
  private tokenCounter: SessionManagerConfig['tokenCounter'];
  private tokenBudget?: SessionManagerConfig['tokenBudget'];
  private compression?: SessionManagerConfig['compression'];
  private sessionTTL?: number;
  private logger: Logger;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: SessionManagerConfig) {
    this.repository = new SessionRepository(config.storage);
    this.eventEmitter = config.eventEmitter ?? new SessionEventEmitter(config.logger);
    this.tokenCounter = config.tokenCounter;
    this.tokenBudget = config.tokenBudget;
    this.compression = config.compression;
    this.sessionTTL = config.sessionTTL;
    this.logger = config.logger ?? noopLogger;

    if (config.cleanupInterval && config.cleanupInterval > 0) {
      this.startCleanupJob(config.cleanupInterval);
    }
  }

  /**
   * Create a new session.
   *
   * @param options - Session creation options
   * @returns The created session
   *
   * @example
   * ```typescript
   * const session = await sessionManager.createSession({
   *   userId: 'user-123',
   *   metadata: { title: 'My Conversation' }
   * });
   * ```
   */
  async createSession<T = Record<string, unknown>>(
    options?: CreateSessionOptions<T>
  ): Promise<Session<T>> {
    const now = new Date();
    const session: Session<T> = {
      id: randomUUID(),
      status: 'active',
      userId: options?.userId,
      activeAgentId: options?.activeAgentId,
      metadata: options?.metadata ?? {},
      participants: options?.participants ?? [],
      schemaVersion: 1,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: this.sessionTTL ? new Date(now.getTime() + this.sessionTTL * 1000) : undefined,
      tokenBudget: options?.tokenBudget ?? this.tokenBudget,
      compression: options?.compression ?? this.compression,
      version: 1,
    };

    // Cast is safe: Session<T> is structurally compatible with Session (Record<string, unknown>)
    const created = await this.repository.createSession(session as Session);
    this.emit('session:created', { sessionId: created.id });
    return created as Session<T>;
  }

  /**
   * Get a session by ID.
   *
   * @param id - Session identifier
   * @returns The session
   * @throws {SessionNotFoundError} If session does not exist
   */
  async getSession(id: SessionId): Promise<Session> {
    const session = await this.repository.getSession(id);
    if (!session) {
      throw new SessionNotFoundError(id);
    }
    return session;
  }

  /**
   * Update a session.
   *
   * @param id - Session identifier
   * @param updates - Partial session updates
   * @returns The updated session
   */
  async updateSession(id: SessionId, updates: Partial<Session>): Promise<Session> {
    const session = await this.getSession(id);
    const updated = await this.repository.updateSession(id, {
      ...updates,
      lastActivityAt: new Date(),
      version: (session.version ?? 1) + 1,
    });
    this.emit('session:updated', { sessionId: id, data: { updates } });
    return updated;
  }

  /**
   * End a session by setting its status to 'completed'.
   *
   * @param id - Session identifier
   */
  async endSession(id: SessionId): Promise<void> {
    await this.repository.updateSession(id, {
      status: 'completed',
      lastActivityAt: new Date(),
    });
    this.emit('session:ended', { sessionId: id });
  }

  /**
   * Delete a session and all its messages.
   *
   * @param id - Session identifier
   */
  async deleteSession(id: SessionId): Promise<void> {
    await this.repository.deleteSession(id);
    this.emit('session:deleted', { sessionId: id });
  }

  /**
   * Add a message to a session.
   *
   * @param sessionId - Session identifier
   * @param message - Message creation options
   * @returns The created message
   * @throws {TokenBudgetExceededError} If budget would be exceeded and overflowStrategy is 'error'
   */
  async addMessage(sessionId: SessionId, message: CreateMessageOptions): Promise<Message> {
    const session = await this.getSession(sessionId);

    const tokenCount = message.tokenCount ?? this.countTokens(message.content, message.metadata);

    if (session.tokenBudget) {
      const budget = new TokenBudget(session.tokenBudget);
      const messages = await this.repository.getMessages(sessionId);
      const currentTokens = messages.reduce(
        (sum, m) => sum + (m.tokenCount ?? this.countTokens(m.content, m.metadata)),
        0
      );

      if (budget.wouldExceedBudget(currentTokens, tokenCount)) {
        if (session.tokenBudget.overflowStrategy === 'error') {
          throw new TokenBudgetExceededError(
            currentTokens + tokenCount,
            session.tokenBudget.maxTokens,
            tokenCount
          );
        }
        // For 'compress' and 'truncate', we allow adding and defer handling to getConversationContext
      }
    }

    const newMessage: Message = {
      id: randomUUID(),
      sessionId,
      role: message.role,
      content: message.content,
      metadata: message.metadata,
      tokenCount,
      createdAt: new Date(),
    };

    const created = await this.repository.addMessage(sessionId, newMessage);
    await this.repository.updateSession(sessionId, { lastActivityAt: new Date() });
    this.emit('message:added', { sessionId, data: { messageId: created.id } });
    return created;
  }

  /**
   * Get messages for a session with optional query filters.
   *
   * @param sessionId - Session identifier
   * @param options - Query options (limit, offset, order, roles, after, before)
   * @returns Array of messages
   */
  async getMessages(sessionId: SessionId, options?: MessageQueryOptions): Promise<Message[]> {
    return this.repository.getMessages(sessionId, options);
  }

  /**
   * Get conversation context for LLM consumption.
   * Automatically applies compression or truncation if configured.
   *
   * @param sessionId - Session identifier
   * @returns Messages within token budget
   */
  async getConversationContext(sessionId: SessionId): Promise<Message[]> {
    const session = await this.getSession(sessionId);

    let messages = await this.repository.getMessages(sessionId, {
      order: 'asc',
    });

    // Apply compression or truncation if over budget
    if (session.tokenBudget) {
      const totalTokens = messages.reduce(
        (sum, m) => sum + (m.tokenCount ?? this.countTokens(m.content, m.metadata)),
        0
      );
      const budget = new TokenBudget(session.tokenBudget);
      const overBudget =
        totalTokens > budget.getAvailableTokens(0) ||
        (session.compression ? totalTokens > session.compression.targetTokens : false);

      if (overBudget) {
        const overflowStrategy = session.tokenBudget.overflowStrategy ?? 'truncate';

        if (overflowStrategy === 'error') {
          throw new TokenBudgetExceededError(
            totalTokens,
            session.tokenBudget.maxTokens,
            totalTokens - session.tokenBudget.maxTokens
          );
        }

        if (overflowStrategy === 'compress' && session.compression) {
          const strategy = this.getCompressionStrategy(session.compression);
          const result = await strategy.compress(messages, session.compression, this.tokenCounter);
          messages = result.compressedMessages;
          this.emit('compression:applied', {
            sessionId,
            data: { strategy: result.strategy, result },
          });
        } else {
          // 'truncate' or 'compress' without compression config
          const window = new MessageWindow({ tokenBudget: session.tokenBudget }, this.tokenCounter);
          messages = window.getFittedMessages(messages);
        }
      }
    }

    // Intentionally no lastActivityAt write on read — lastActivityAt is bumped on
    // addMessage / updateSession / handoff. Writing here would force a DB round trip
    // on every LLM context fetch.
    return messages;
  }

  /**
   * Add a participant to a session.
   *
   * @param sessionId - Session identifier
   * @param participant - Participant creation options
   * @returns The created participant
   */
  async addParticipant(
    sessionId: SessionId,
    participant: CreateParticipantOptions
  ): Promise<Participant> {
    const session = await this.getSession(sessionId);
    const newParticipant: Participant = {
      ...participant,
      joinedAt: new Date(),
    };
    const participants = [...session.participants, newParticipant];
    await this.repository.updateSession(sessionId, { participants, lastActivityAt: new Date() });
    this.emit('participant:joined', { sessionId, data: { participantId: participant.id } });
    return newParticipant;
  }

  /**
   * Mark a participant as left in a session.
   *
   * @param sessionId - Session identifier
   * @param participantId - Participant identifier
   */
  async removeParticipant(sessionId: SessionId, participantId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    const participants = session.participants.map((p) =>
      p.id === participantId ? { ...p, leftAt: new Date() } : p
    );
    await this.repository.updateSession(sessionId, { participants, lastActivityAt: new Date() });
    this.emit('participant:left', { sessionId, data: { participantId } });
  }

  /**
   * Get all participants in a session.
   *
   * @param sessionId - Session identifier
   * @returns Array of participants
   */
  async getParticipants(sessionId: SessionId): Promise<Participant[]> {
    const session = await this.getSession(sessionId);
    return session.participants;
  }

  /**
   * Hand off a session to a different agent.
   *
   * @remarks Does not require the target agent to be an existing participant —
   * the caller is responsible for any authorization or membership checks.
   *
   * @param sessionId - Session identifier
   * @param agentId - Target agent identifier
   * @param context - Optional handoff context
   * @throws {HandoffError} If session is already assigned to the target agent
   */
  async handoffToAgent(
    sessionId: SessionId,
    agentId: string,
    context?: HandoffContext
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    const previousAgentId = session.activeAgentId;

    if (previousAgentId === agentId) {
      throw new HandoffError(`Session is already assigned to agent ${agentId}`);
    }

    await this.repository.updateSession(sessionId, {
      activeAgentId: agentId,
      lastActivityAt: new Date(),
    });

    this.emit('agent:handoff', {
      sessionId,
      data: { fromAgent: previousAgentId, toAgent: agentId, reason: context?.reason },
    });
  }

  /**
   * Compress conversation context using the configured or specified strategy.
   *
   * @param sessionId - Session identifier
   * @param strategyType - Optional compression strategy override
   * @returns Compression result
   */
  async compressContext(
    sessionId: SessionId,
    strategyType?: CompressionStrategyType
  ): Promise<CompressionResult> {
    const session = await this.getSession(sessionId);
    const messages = await this.repository.getMessages(sessionId, { order: 'asc' });

    const compressionConfig = session.compression ?? this.compression;
    if (!compressionConfig) {
      throw new ValidationError('No compression config available');
    }

    const config = strategyType
      ? ({ ...compressionConfig, strategy: strategyType } as CompressionConfig)
      : compressionConfig;

    const strategy = this.getCompressionStrategy(config);
    const result = await strategy.compress(messages, config, this.tokenCounter);
    this.emit('compression:applied', { sessionId, data: { strategy: result.strategy, result } });
    return result;
  }

  /**
   * Clean up expired sessions.
   *
   * @returns Number of expired sessions found (attempted to clean up)
   */
  async cleanupExpiredSessions(): Promise<number> {
    const expiredIds = await this.repository.getExpiredSessions(new Date());
    for (const id of expiredIds) {
      try {
        await this.repository.deleteSession(id);
        this.emit('session:expired', { sessionId: id });
      } catch (error) {
        this.logger.error(`Failed to cleanup expired session ${id}:`, error);
      }
    }
    return expiredIds.length;
  }

  /**
   * Subscribe to a session event.
   *
   * @param event - Event type
   * @param handler - Event handler function
   */
  on(event: SessionEvent, handler: EventHandler): void {
    this.eventEmitter.on(event, handler);
  }

  /**
   * Unsubscribe from a session event.
   *
   * @param event - Event type
   * @param handler - Event handler function
   */
  off(event: SessionEvent, handler: EventHandler): void {
    this.eventEmitter.off(event, handler);
  }

  /**
   * Check the health of the storage adapter.
   *
   * @returns Health status
   */
  async health(): Promise<HealthStatus> {
    return this.repository.health();
  }

  /**
   * Close the session manager and stop cleanup jobs.
   */
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    await this.repository.close();
  }

  private startCleanupJob(intervalSeconds: number): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions().catch((error) => {
        this.logger.error('Cleanup job error:', error);
      });
    }, intervalSeconds * 1000);
    // Don't block process exit on the cleanup interval.
    (this.cleanupTimer as { unref?: () => void }).unref?.();
  }

  private emit(
    event: SessionEvent,
    payload: Omit<SessionEventPayload, 'type' | 'timestamp'>
  ): void {
    this.eventEmitter.emit(event, payload);
  }

  private getCompressionStrategy(config: CompressionConfig): ICompressionStrategy {
    switch (config.strategy) {
      case 'sliding_window':
        return new SlidingWindowStrategy();
      case 'summarization': {
        if (!config.summarizer) {
          throw new ValidationError(
            `Compression strategy 'summarization' requires a summarizer service. Provide it via compression.summarizer in SessionManager config.`
          );
        }
        return new SummarizationStrategy(config.summarizer);
      }
      case 'hybrid': {
        if (!config.summarizer) {
          throw new ValidationError(
            `Compression strategy 'hybrid' requires a summarizer service. Provide it via compression.summarizer in SessionManager config.`
          );
        }
        return new HybridStrategy(config.summarizer);
      }
      default:
        throw new ValidationError(
          `Unsupported compression strategy: ${(config as { strategy: string }).strategy}`
        );
    }
  }

  private countTokens(content: MessageContent, metadata?: MessageMetadata): number {
    let text: string;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('');
    } else {
      text = JSON.stringify(content);
    }
    let count = this.tokenCounter.count(text);

    if (metadata?.toolCalls) {
      for (const toolCall of metadata.toolCalls) {
        count += this.tokenCounter.count(toolCall.name);
        count += this.tokenCounter.count(toolCall.arguments);
      }
    }

    if (metadata?.toolResults) {
      for (const toolResult of metadata.toolResults) {
        count += this.tokenCounter.count(toolResult.result);
      }
    }

    return count;
  }
}
