import type { IStorageAdapter } from './storage.js';
import type { TokenCounter, TokenBudgetConfig } from './token.js';
import type { CompressionConfig } from './compression.js';
import type {
  SessionMetadata,
  Participant,
  MessageRole,
  MessageMetadata,
  MessageContent,
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
  /** Session TTL in seconds */
  sessionTTL?: number;
  /** Interval for cleanup job (in seconds, 0 to disable) */
  cleanupInterval?: number;
  /** Event emitter for session events */
  eventEmitter?: SessionEventEmitter;
  /** Logger (defaults to no-op logger) */
  logger?: Logger;
}

/** Minimal logger interface */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
