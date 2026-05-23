import type { IStorageAdapter } from './storage.js';
import type { TokenCounter, TokenBudgetConfig, BudgetStatus } from './token.js';
import type { CompressionConfig, CompressionStrategyType } from './compression.js';
import type {
  SessionMetadata,
  Participant,
  MessageRole,
  MessageMetadata,
  MessageContent,
  Message,
} from './session.js';
import type { SessionEventEmitter } from '../events/SessionEventEmitter.js';

/** Options for creating a new session */
export interface CreateSessionOptions<T = Record<string, unknown>> {
  userId?: string;
  activeAgentId?: string;
  metadata?: SessionMetadata<T>;
  participants?: Participant[];
  tokenBudget?: TokenBudgetConfig;
  compression?: CompressionConfig;
}

/** Options for creating a message */
export interface CreateMessageOptions {
  role: MessageRole;
  content: MessageContent;
  metadata?: MessageMetadata;
  tokenCount?: number;
}

/** Options for creating a participant */
export interface CreateParticipantOptions {
  id: string;
  role: 'user' | 'agent' | 'observer';
  metadata?: Record<string, unknown>;
}

/** Context passed during an agent handoff */
export interface HandoffContext {
  reason?: string;
  context?: Record<string, unknown>;
}

/** Configuration for MessageWindow */
export interface MessageWindowConfig {
  tokenBudget: TokenBudgetConfig;
}

/** Configuration for SessionManager */
export interface SessionManagerConfig {
  /** Storage adapter instance */
  storage: IStorageAdapter;
  /** Token counter implementation */
  tokenCounter: TokenCounter;
  /** Default token budget */
  tokenBudget?: TokenBudgetConfig;
  /** Default compression strategy */
  compression?: CompressionConfig;
  /**
   * Tokens to charge per `image_url` content block when counting message
   * tokens. Text tokenizers can't measure images, so they'd otherwise count as
   * zero and understate the budget for multi-modal conversations. Defaults to
   * 0 (preserving text-only behavior); set it to your model's per-image cost
   * (e.g. ~85 for an OpenAI low-detail image) when sending vision content.
   */
  imageTokenCost?: number;
  /** Session TTL in seconds */
  sessionTTL?: number;
  /** Interval for cleanup job (in seconds, 0 to disable) */
  cleanupInterval?: number;
  /** Event emitter for session events */
  eventEmitter?: SessionEventEmitter;
  /** Logger (defaults to no-op logger) */
  logger?: Logger;
}

/** Diagnostics describing how a context fetch fit within budget. */
export interface ContextCompressionInfo {
  /** Whether compression or truncation was applied. */
  applied: boolean;
  /** Whether the result was served from the cached compression state (no LLM call). */
  fromCache: boolean;
  /** Strategy used, when compression (not plain truncation) ran. */
  strategy?: CompressionStrategyType;
  /** Token count before compression. */
  originalTokenCount: number;
  /** Token count of the returned context. */
  compressedTokenCount: number;
  /** Number of messages dropped or folded into a summary. */
  droppedMessageCount: number;
  /** Summary text, when a summarizing strategy ran. */
  summary?: string;
}

/** Conversation context plus the budget/compression diagnostics behind it. */
export interface ConversationContextResult {
  /** Messages fitted within the token budget. */
  messages: Message[];
  /** Budget snapshot for the returned context, when a budget is configured. */
  budget?: BudgetStatus;
  /** How the context was fitted, when a budget is configured. */
  compression?: ContextCompressionInfo;
}

/** Minimal logger interface */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
