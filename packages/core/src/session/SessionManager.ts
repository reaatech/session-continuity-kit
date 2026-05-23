import type {
  Session,
  SessionId,
  Message,
  MessageId,
  Participant,
  MessageMetadata,
  MessageContent,
  CompressionState,
} from '../types/session.js';
import type {
  CreateSessionOptions,
  CreateMessageOptions,
  CreateParticipantOptions,
  HandoffContext,
  SessionManagerConfig,
  ConversationContextResult,
} from '../types/config.js';
import type { MessageQueryOptions, SessionFilters } from '../types/storage.js';
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
  ConcurrencyError,
} from '../types/errors.js';
import { randomUUID } from 'node:crypto';
import { SessionEventEmitter } from '../events/SessionEventEmitter.js';
import { SessionRepository } from '../repository/SessionRepository.js';
import { MessageWindow } from './MessageWindow.js';
import { TokenBudget } from './TokenBudget.js';
import { compareMessages } from '../compression/CompressionStrategy.js';
import { SlidingWindowStrategy } from '../compression/SlidingWindowStrategy.js';
import { SummarizationStrategy } from '../compression/SummarizationStrategy.js';
import { HybridStrategy } from '../compression/HybridStrategy.js';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Max attempts for an optimistic-concurrency read-modify-write before giving up. */
const MAX_CAS_RETRIES = 5;

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
  private imageTokenCost: number;
  private sessionTTL?: number;
  private logger: Logger;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: SessionManagerConfig) {
    this.repository = new SessionRepository(config.storage);
    this.eventEmitter = config.eventEmitter ?? new SessionEventEmitter(config.logger);
    this.tokenCounter = config.tokenCounter;
    this.tokenBudget = config.tokenBudget;
    this.compression = config.compression;
    this.imageTokenCost = config.imageTokenCost ?? 0;
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
      tokenCount: 0,
      messageCount: 0,
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
   * List sessions with optional filters.
   *
   * @param filters - Query filters (userId, status, activeAgentId, tags, date range, paging)
   * @returns Array of matching sessions
   */
  async listSessions(filters?: SessionFilters): Promise<Session[]> {
    return this.repository.listSessions(filters);
  }

  /**
   * Update a session. Uses optimistic concurrency: the write is rejected and
   * retried if another writer modified the session first.
   *
   * @param id - Session identifier
   * @param updates - Partial session updates
   * @returns The updated session
   */
  async updateSession(id: SessionId, updates: Partial<Session>): Promise<Session> {
    const { session } = await this.applyUpdate(id, () => ({ updates }));
    this.emit('session:updated', { sessionId: id, data: { updates } });
    return session;
  }

  /**
   * End a session by setting its status to 'completed'.
   *
   * @param id - Session identifier
   * @throws {SessionNotFoundError} If session does not exist
   */
  async endSession(id: SessionId): Promise<void> {
    await this.applyUpdate(id, () => ({ updates: { status: 'completed' } }));
    this.emit('session:ended', { sessionId: id });
  }

  /**
   * Delete a session and all its messages.
   *
   * @param id - Session identifier
   * @throws {SessionNotFoundError} If session does not exist
   */
  async deleteSession(id: SessionId): Promise<void> {
    // Ensure it exists so deletion semantics match getSession (throws on missing).
    await this.getSession(id);
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
      // Use the running total instead of re-summing every stored message (O(1) vs O(n)).
      const currentTokens = await this.currentTokenCount(session);

      if (budget.wouldExceedBudget(currentTokens, tokenCount)) {
        if (session.tokenBudget.overflowStrategy === 'error') {
          this.emit('budget:exceeded', {
            sessionId,
            data: { used: currentTokens + tokenCount, limit: session.tokenBudget.maxTokens },
          });
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

    // Maintain running totals (concurrency-safe via CAS retry).
    await this.applyUpdate(sessionId, (fresh) => ({
      updates: {
        tokenCount: (fresh.tokenCount ?? 0) + tokenCount,
        messageCount: (fresh.messageCount ?? 0) + 1,
      },
    }));

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
   * Update a message. Recomputes the message's token count (and the session's
   * running total) when content changes without an explicit token count.
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier
   * @param updates - Partial message updates
   * @returns The updated message
   * @throws {ValidationError} If the message does not belong to the session
   */
  async updateMessage(
    sessionId: SessionId,
    messageId: MessageId,
    updates: Partial<Message>
  ): Promise<Message> {
    const existing = await this.findMessage(sessionId, messageId);
    const oldTokens = existing.tokenCount ?? this.countTokens(existing.content, existing.metadata);

    const next: Partial<Message> = { ...updates };
    if (
      next.tokenCount === undefined &&
      (next.content !== undefined || next.metadata !== undefined)
    ) {
      next.tokenCount = this.countTokens(
        next.content ?? existing.content,
        next.metadata ?? existing.metadata
      );
    }
    next.updatedAt = new Date();

    const updated = await this.repository.updateMessage(sessionId, messageId, next);

    const newTokens = updated.tokenCount ?? this.countTokens(updated.content, updated.metadata);
    if (newTokens !== oldTokens) {
      await this.applyUpdate(sessionId, (fresh) => ({
        updates: {
          tokenCount: Math.max(0, (fresh.tokenCount ?? 0) + (newTokens - oldTokens)),
          // Cached compression no longer reflects the messages; force a recompute.
          compressionState: undefined,
        },
      }));
    }

    this.emit('message:updated', { sessionId, data: { messageId } });
    return updated;
  }

  /**
   * Delete a message and decrement the session's running totals.
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier
   * @throws {ValidationError} If the message does not belong to the session
   */
  async deleteMessage(sessionId: SessionId, messageId: MessageId): Promise<void> {
    const existing = await this.findMessage(sessionId, messageId);
    const tokens = existing.tokenCount ?? this.countTokens(existing.content, existing.metadata);

    await this.repository.deleteMessage(sessionId, messageId);

    await this.applyUpdate(sessionId, (fresh) => ({
      updates: {
        tokenCount: Math.max(0, (fresh.tokenCount ?? 0) - tokens),
        messageCount: Math.max(0, (fresh.messageCount ?? 0) - 1),
        compressionState: undefined,
      },
    }));

    this.emit('message:deleted', { sessionId, data: { messageId } });
  }

  /**
   * Get conversation context for LLM consumption.
   * Automatically applies compression or truncation if configured.
   *
   * @param sessionId - Session identifier
   * @returns Messages within token budget
   */
  async getConversationContext(sessionId: SessionId): Promise<Message[]> {
    const { messages } = await this.assembleContext(sessionId);
    return messages;
  }

  /**
   * Like {@link getConversationContext}, but also returns budget and compression
   * diagnostics — how many tokens/messages were dropped, whether a summary was
   * used, and whether it was served from cache. Useful for production metering.
   *
   * @param sessionId - Session identifier
   * @returns Messages plus budget/compression diagnostics
   */
  async getConversationContextWithStats(sessionId: SessionId): Promise<ConversationContextResult> {
    return this.assembleContext(sessionId);
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
    const newParticipant: Participant = {
      ...participant,
      joinedAt: new Date(),
    };
    await this.applyUpdate(sessionId, (fresh) => ({
      updates: { participants: [...fresh.participants, newParticipant] },
    }));
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
    await this.applyUpdate(sessionId, (fresh) => ({
      updates: {
        participants: fresh.participants.map((p) =>
          p.id === participantId ? { ...p, leftAt: new Date() } : p
        ),
      },
    }));
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
    let previousAgentId: string | undefined;
    await this.applyUpdate(sessionId, (fresh) => {
      if (fresh.activeAgentId === agentId) {
        throw new HandoffError(`Session is already assigned to agent ${agentId}`);
      }
      previousAgentId = fresh.activeAgentId;
      return { updates: { activeAgentId: agentId } };
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

  /**
   * Read-modify-write a session with optimistic-concurrency retry. Reads the
   * latest session, applies `mutator`, and writes with the read version as the
   * expected version. On a {@link ConcurrencyError} it re-reads and retries.
   */
  private async applyUpdate<R = void>(
    id: SessionId,
    mutator: (session: Session) => { updates: Partial<Session>; result?: R }
  ): Promise<{ session: Session; result?: R }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const session = await this.getSession(id);
      const { updates, result } = mutator(session);
      const expectedVersion = session.version ?? 0;
      try {
        const updated = await this.repository.updateSession(
          id,
          {
            ...updates,
            lastActivityAt: new Date(),
            version: expectedVersion + 1,
          },
          { expectedVersion }
        );
        return { session: updated, result };
      } catch (error) {
        if (error instanceof ConcurrencyError) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  /** Resolve the running token total, falling back to a one-time sum for legacy sessions. */
  private async currentTokenCount(session: Session): Promise<number> {
    if (typeof session.tokenCount === 'number') {
      return session.tokenCount;
    }
    const messages = await this.repository.getMessages(session.id);
    return messages.reduce((sum, m) => sum + this.messageTokens(m), 0);
  }

  private messageTokens(message: Message): number {
    return message.tokenCount ?? this.countTokens(message.content, message.metadata);
  }

  private async findMessage(sessionId: SessionId, messageId: MessageId): Promise<Message> {
    const messages = await this.repository.getMessages(sessionId);
    const message = messages.find((m) => m.id === messageId);
    if (!message) {
      throw new ValidationError(`Message ${messageId} not found in session ${sessionId}`);
    }
    return message;
  }

  private async assembleContext(sessionId: SessionId): Promise<ConversationContextResult> {
    const session = await this.getSession(sessionId);

    let messages = await this.repository.getMessages(sessionId, { order: 'asc' });

    if (!session.tokenBudget) {
      // Intentionally no lastActivityAt write on read.
      return { messages };
    }

    const budget = new TokenBudget(session.tokenBudget);
    const originalCount = messages.length;
    const totalTokens = messages.reduce((sum, m) => sum + this.messageTokens(m), 0);
    const available = budget.getAvailableTokens(0);
    const target = session.compression?.targetTokens;
    const overBudget = totalTokens > available || (target !== undefined && totalTokens > target);

    if (!overBudget) {
      return {
        messages,
        budget: budget.getStatus(totalTokens),
        compression: {
          applied: false,
          fromCache: false,
          originalTokenCount: totalTokens,
          compressedTokenCount: totalTokens,
          droppedMessageCount: 0,
        },
      };
    }

    const overflowStrategy = session.tokenBudget.overflowStrategy ?? 'truncate';

    if (overflowStrategy === 'error') {
      this.emit('budget:exceeded', {
        sessionId,
        data: { used: totalTokens, limit: session.tokenBudget.maxTokens },
      });
      throw new TokenBudgetExceededError(
        totalTokens,
        session.tokenBudget.maxTokens,
        totalTokens - session.tokenBudget.maxTokens
      );
    }

    if (overflowStrategy === 'compress' && session.compression) {
      const signature = this.contextSignature(messages, totalTokens);

      // Reuse a cached summary when the message set is unchanged — avoids
      // re-invoking the (LLM-backed) summarizer on every context fetch.
      const cached = session.compressionState;
      if (cached?.summary !== undefined && cached.signature === signature) {
        messages = this.rebuildFromCache(messages, cached);
        return {
          messages,
          budget: budget.getStatus(cached.compressedTokenCount),
          compression: {
            applied: true,
            fromCache: true,
            strategy: cached.strategy,
            originalTokenCount: totalTokens,
            compressedTokenCount: cached.compressedTokenCount,
            droppedMessageCount: originalCount - messages.length,
            summary: cached.summary,
          },
        };
      }

      const strategy = this.getCompressionStrategy(session.compression);
      const result = await strategy.compress(messages, session.compression, this.tokenCounter);
      messages = result.compressedMessages;

      // Cache only summary-producing strategies; that's the expensive path.
      if (result.summary !== undefined) {
        const originalIds = new Set(result.originalMessages.map((m) => m.id));
        const state: CompressionState = {
          strategy: result.strategy,
          summary: result.summary,
          summaryTokenCount: this.tokenCounter.count(result.summary),
          keptMessageIds: result.compressedMessages
            .filter((m) => m.role !== 'system' && originalIds.has(m.id))
            .map((m) => m.id),
          signature,
          compressedTokenCount: result.compressedTokenCount,
          updatedAt: new Date(),
        };
        // Best-effort cache write; a lost race just means recompute next time.
        try {
          await this.repository.updateSession(sessionId, { compressionState: state });
        } catch (error) {
          this.logger.warn('Failed to persist compression state', error);
        }
      }

      this.emit('compression:applied', {
        sessionId,
        data: { strategy: result.strategy, result },
      });

      return {
        messages,
        budget: budget.getStatus(result.compressedTokenCount),
        compression: {
          applied: true,
          fromCache: false,
          strategy: result.strategy,
          originalTokenCount: result.originalTokenCount,
          compressedTokenCount: result.compressedTokenCount,
          droppedMessageCount: result.removedMessages.length,
          summary: result.summary,
        },
      };
    }

    // 'truncate', or 'compress' without a compression config.
    const window = new MessageWindow({ tokenBudget: session.tokenBudget }, this.tokenCounter);
    const fitted = window.getFittedMessages(messages);
    const fittedTokens = fitted.reduce((sum, m) => sum + this.messageTokens(m), 0);
    return {
      messages: fitted,
      budget: budget.getStatus(fittedTokens),
      compression: {
        applied: true,
        fromCache: false,
        originalTokenCount: totalTokens,
        compressedTokenCount: fittedTokens,
        droppedMessageCount: originalCount - fitted.length,
      },
    };
  }

  /** Fingerprint of the message set used to invalidate cached compression state. */
  private contextSignature(messages: Message[], totalTokens: number): string {
    const last = messages[messages.length - 1];
    return `${messages.length}:${last?.id ?? ''}:${last?.sequence ?? ''}:${totalTokens}`;
  }

  /** Reconstruct a cached summarization result against the current live messages. */
  private rebuildFromCache(messages: Message[], state: CompressionState): Message[] {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const keptSet = new Set(state.keptMessageIds);
    const kept = messages.filter((m) => keptSet.has(m.id)).sort(compareMessages);

    const summaryMessage: Message = {
      id: randomUUID(),
      sessionId: messages[0]?.sessionId ?? '',
      role: 'system',
      content: `Previous conversation summary: ${state.summary}`,
      createdAt: new Date(0),
      tokenCount: state.summaryTokenCount,
    };

    return [...systemMessages, summaryMessage, ...kept];
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
    let imageBlocks = 0;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('');
      imageBlocks = content.filter((block) => block.type === 'image_url').length;
    } else {
      text = JSON.stringify(content);
    }
    let count = this.tokenCounter.count(text);
    count += imageBlocks * this.imageTokenCost;

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
