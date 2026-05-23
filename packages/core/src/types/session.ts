/** Unique identifier for a session */
export type SessionId = string;

/** Unique identifier for a message */
export type MessageId = string;

/** Role of a message sender */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/** Content of a message — plain text or multi-modal blocks */
export type MessageContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

/** Participant in a session */
export interface Participant {
  id: string;
  role: 'user' | 'agent' | 'observer';
  metadata?: Record<string, unknown>;
  joinedAt: Date;
  leftAt?: Date;
}

/** A single message in a conversation */
export interface Message {
  id: MessageId;
  sessionId: SessionId;
  role: MessageRole;
  content: MessageContent;
  /** Token count for this message (pre-computed or lazy) */
  tokenCount?: number;
  /**
   * Monotonically increasing per-session insertion sequence. Assigned by the
   * storage adapter on write. Used as a deterministic tie-breaker when two
   * messages share the same `createdAt` millisecond. Adapters that don't assign
   * it fall back to `(createdAt, id)` ordering.
   */
  sequence?: number;
  /** References to tool calls or other metadata */
  metadata?: MessageMetadata;
  createdAt: Date;
  updatedAt?: Date;
}

export interface MessageMetadata {
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  annotations?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  toolCallId: string;
  result: string;
  isError?: boolean;
}

/** Session status */
export type SessionStatus = 'active' | 'paused' | 'completed' | 'expired';

/** Session-level metadata */
export interface SessionMetadata<T = Record<string, unknown>> {
  title?: string;
  tags?: string[];
  source?: string;
  custom?: T;
}

import type { TokenBudgetConfig } from './token.js';
import type { CompressionConfig, CompressionStrategyType } from './compression.js';

/**
 * Cached result of the most recent compression pass. Lets {@link Session}
 * consumers reuse an expensive (LLM-backed) summary instead of recomputing it
 * on every context fetch. Invalidated when the underlying message set changes,
 * detected via {@link CompressionState.signature}.
 */
export interface CompressionState {
  /** Strategy that produced this state. */
  strategy: CompressionStrategyType;
  /** Summary text, if the strategy produced one. */
  summary?: string;
  /** Token count of the summary message. */
  summaryTokenCount?: number;
  /** IDs of the non-system messages kept verbatim alongside the summary, in order. */
  keptMessageIds: MessageId[];
  /**
   * Fingerprint of the message set this state was computed from. When the live
   * message set produces the same signature, the cached state can be reused.
   */
  signature: string;
  /** Token count of the compressed output. */
  compressedTokenCount: number;
  /** When this state was last recomputed. */
  updatedAt: Date;
}

/** A conversation session */
export interface Session<T = Record<string, unknown>> {
  id: SessionId;
  /** User identifier for multi-session tracking */
  userId?: string;
  /** Current active agent/handler */
  activeAgentId?: string;
  /** Session status */
  status: SessionStatus;
  /** Session-level metadata */
  metadata: SessionMetadata<T>;
  /** Participants in this session */
  participants: Participant[];
  /** Schema version for migration support */
  schemaVersion: number;
  /** When this session was created */
  createdAt: Date;
  /** Last activity timestamp (for TTL) */
  lastActivityAt: Date;
  /** When session expires (computed from TTL) */
  expiresAt?: Date;
  /** Token budget configuration */
  tokenBudget?: TokenBudgetConfig;
  /** Compression configuration */
  compression?: CompressionConfig;
  /**
   * Running total of tokens across all messages in the session. Maintained
   * incrementally on add/update/delete so the budget hot path doesn't re-sum
   * every message. Undefined on sessions created before this field existed.
   */
  tokenCount?: number;
  /** Running count of messages in the session. */
  messageCount?: number;
  /** Cached compression result; see {@link CompressionState}. */
  compressionState?: CompressionState;
  /**
   * Optimistic-concurrency token. Incremented on every successful update.
   * Adapters that support conditional writes (see {@link IStorageAdapter.updateSession})
   * use it to reject stale writes with a `ConcurrencyError`.
   */
  version?: number;
}
