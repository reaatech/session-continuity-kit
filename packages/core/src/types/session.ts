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
import type { CompressionConfig } from './compression.js';

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
  /** Reserved for future optimistic concurrency control. Not currently enforced by any adapter. */
  version?: number;
}
