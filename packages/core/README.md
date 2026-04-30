# @reaatech/session-continuity

[![npm version](https://img.shields.io/npm/v/@reaatech/session-continuity.svg)](https://www.npmjs.com/package/@reaatech/session-continuity)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/session-continuity-kit/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/session-continuity-kit/ci.yml?branch=main&label=CI)](https://github.com/reaatech/session-continuity-kit/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Core abstractions and session management for multi-turn AI agent conversations. Provides the `SessionManager` orchestrator, typed interfaces (`IStorageAdapter`, `TokenCounter`, `ICompressionStrategy`), three compression strategies, a typed event system, and error classes — everything needed to manage LLM conversation context.

## Installation

```bash
npm install @reaatech/session-continuity
# or
pnpm add @reaatech/session-continuity
```

## Feature Overview

- **SessionManager** — full session lifecycle: create, update, end, delete; message/participant management; agent handoff; token budget enforcement; context compression
- **Three compression strategies** — Sliding Window (recent messages), Summarization (LLM-powered summary), Hybrid (recent + summarized history)
- **Typed event system** — subscribe to 14 session lifecycle events (`session:created`, `message:added`, `compression:applied`, `agent:handoff`, etc.)
- **Storage-agnostic** — the `IStorageAdapter` interface decouples session management from storage; swap backends without changing application code
- **7 typed error classes** — `SessionNotFoundError`, `TokenBudgetExceededError`, `StorageError`, `CompressionError`, `ValidationError`, `HandoffError`, `SessionError`
- **Zero runtime dependencies** — lightweight and tree-shakeable

## Quick Start

```typescript
import { SessionManager } from '@reaatech/session-continuity';
import { MemoryAdapter } from '@reaatech/session-continuity-storage-memory';
import { TiktokenTokenizer } from '@reaatech/session-continuity-tokenizers';

const manager = new SessionManager({
  storage: new MemoryAdapter(),
  tokenCounter: new TiktokenTokenizer('gpt-4'),
  tokenBudget: {
    maxTokens: 4096,
    reserveTokens: 500,
    overflowStrategy: 'compress',
  },
  compression: {
    strategy: 'sliding_window',
    targetTokens: 3500,
  },
});

const session = await manager.createSession({ userId: 'user-123' });

await manager.addMessage(session.id, { role: 'user', content: 'Hello!' });
await manager.addMessage(session.id, { role: 'assistant', content: 'Hi! How can I help?' });

const context = await manager.getConversationContext(session.id);
```

## API Reference

### `SessionManager`

#### Constructor

```typescript
new SessionManager(config: SessionManagerConfig)
```

#### `SessionManagerConfig`

| Property          | Type                  | Default    | Description                                    |
| ----------------- | --------------------- | ---------- | ---------------------------------------------- |
| `storage`         | `IStorageAdapter`     | (required) | Storage backend for sessions and messages      |
| `tokenCounter`    | `TokenCounter`        | (required) | Token counting implementation                  |
| `tokenBudget`     | `TokenBudgetConfig`   | —          | Default token budget configuration             |
| `compression`     | `CompressionConfig`   | —          | Default compression strategy and settings      |
| `sessionTTL`      | `number`              | —          | Session TTL in seconds                         |
| `cleanupInterval` | `number`              | `0`        | Cleanup job interval in seconds (0 = disabled) |
| `eventEmitter`    | `SessionEventEmitter` | —          | Custom event emitter instance                  |
| `logger`          | `Logger`              | —          | Logger implementation (no-op by default)       |

#### Session Lifecycle

| Method                       | Returns            | Description                                    |
| ---------------------------- | ------------------ | ---------------------------------------------- |
| `createSession(options?)`    | `Promise<Session>` | Create a new session                           |
| `getSession(id)`             | `Promise<Session>` | Retrieve by ID (throws `SessionNotFoundError`) |
| `updateSession(id, updates)` | `Promise<Session>` | Partial update                                 |
| `endSession(id)`             | `Promise<void>`    | Mark session as completed                      |
| `deleteSession(id)`          | `Promise<void>`    | Delete session and all messages                |

#### Message Management

| Method                              | Returns              | Description                            |
| ----------------------------------- | -------------------- | -------------------------------------- |
| `addMessage(sessionId, message)`    | `Promise<Message>`   | Add a message (enforces token budget)  |
| `getMessages(sessionId, options?)`  | `Promise<Message[]>` | Query messages with filtering          |
| `getConversationContext(sessionId)` | `Promise<Message[]>` | Get compressed/fitted messages for LLM |

#### Participants & Handoff

| Method                                         | Returns                  | Description                       |
| ---------------------------------------------- | ------------------------ | --------------------------------- |
| `addParticipant(sessionId, participant)`       | `Promise<Participant>`   | Add a participant                 |
| `removeParticipant(sessionId, participantId)`  | `Promise<void>`          | Remove a participant              |
| `getParticipants(sessionId)`                   | `Promise<Participant[]>` | List participants                 |
| `handoffToAgent(sessionId, agentId, context?)` | `Promise<void>`          | Transfer session to another agent |

#### Compression & Cleanup

| Method                                      | Returns                      | Description                  |
| ------------------------------------------- | ---------------------------- | ---------------------------- |
| `compressContext(sessionId, strategyType?)` | `Promise<CompressionResult>` | Manually trigger compression |
| `cleanupExpiredSessions()`                  | `Promise<number>`            | Remove expired sessions      |

#### Events & Health

| Method                | Returns                 | Description                 |
| --------------------- | ----------------------- | --------------------------- |
| `on(event, handler)`  | `void`                  | Subscribe to session events |
| `off(event, handler)` | `void`                  | Unsubscribe from events     |
| `health()`            | `Promise<HealthStatus>` | Check storage health        |
| `close()`             | `Promise<void>`         | Stop cleanup, close storage |

### Core Types

#### `Session<T>`

```typescript
interface Session<T = Record<string, unknown>> {
  id: SessionId; // string
  userId?: string;
  activeAgentId?: string;
  status: 'active' | 'paused' | 'completed' | 'expired';
  metadata: { title?: string; tags?: string[]; source?: string; custom?: T };
  participants: Participant[];
  schemaVersion: number;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt?: Date;
  tokenBudget?: TokenBudgetConfig;
  compression?: CompressionConfig;
}
```

#### `Message`

```typescript
interface Message {
  id: string; // MessageId
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | MultiModalContent[];
  tokenCount?: number;
  metadata?: {
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    annotations?: Record<string, unknown>;
  };
  createdAt: Date;
}
```

#### `TokenBudgetConfig`

| Property           | Type                                      | Description                                   |
| ------------------ | ----------------------------------------- | --------------------------------------------- |
| `maxTokens`        | `number`                                  | Maximum tokens allowed in the session context |
| `reserveTokens`    | `number`                                  | Tokens reserved for LLM response              |
| `overflowStrategy` | `"truncate"` \| `"compress"` \| `"error"` | Action when budget is exceeded                |

#### `CompressionConfig` (discriminated union)

```typescript
type CompressionConfig =
  | { strategy: 'sliding_window'; targetTokens: number; minMessages?: number; maxMessages?: number }
  | {
      strategy: 'summarization';
      targetTokens: number;
      summarizer: SummarizerService;
      summarizationPrompt?: string;
      summaryOverhead?: number;
    }
  | {
      strategy: 'hybrid';
      targetTokens: number;
      maxMessages?: number;
      summarizer: SummarizerService;
      summarizationPrompt?: string;
      summaryOverhead?: number;
    };
```

### `IStorageAdapter` Interface

The contract all storage adapters implement:

```typescript
interface IStorageAdapter {
  createSession(session: Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'>): Promise<Session>;
  getSession(id: SessionId): Promise<Session | null>;
  updateSession(id: SessionId, updates: Partial<Session>): Promise<Session>;
  deleteSession(id: SessionId): Promise<void>;
  listSessions(filters?: SessionFilters): Promise<Session[]>;
  addMessage(
    sessionId: SessionId,
    message: Omit<Message, 'id' | 'sessionId' | 'createdAt'>
  ): Promise<Message>;
  getMessages(sessionId: SessionId, options?: MessageQueryOptions): Promise<Message[]>;
  updateMessage(
    sessionId: SessionId,
    messageId: MessageId,
    updates: Partial<Message>
  ): Promise<Message>;
  deleteMessage(sessionId: SessionId, messageId: MessageId): Promise<void>;
  deleteAllMessages(sessionId: SessionId): Promise<void>;
  getExpiredSessions(before: Date): Promise<SessionId[]>;
  health(): Promise<HealthStatus>;
  close(): Promise<void>;
}
```

### Compression Strategies

#### `SlidingWindowStrategy`

Keeps the most recent messages that fit within the token budget. Always preserves system messages. Respects `minMessages` and `maxMessages` constraints.

```typescript
import { SlidingWindowStrategy } from '@reaatech/session-continuity';

const strategy = new SlidingWindowStrategy();
const result = await strategy.compress(
  messages,
  {
    strategy: 'sliding_window',
    targetTokens: 3500,
    minMessages: 5,
  },
  tokenCounter
);
```

#### `SummarizationStrategy`

Summarizes older messages via an LLM, keeping recent messages as-is. Generates a synthetic system message from the summary.

```typescript
import { SummarizationStrategy, type SummarizerService } from '@reaatech/session-continuity';

const strategy = new SummarizationStrategy(mySummarizerService);
const result = await strategy.compress(
  messages,
  {
    strategy: 'summarization',
    targetTokens: 3500,
    summarizationPrompt: 'Summarize the key points in 2-3 sentences.',
  },
  tokenCounter
);
```

#### `HybridStrategy`

Keeps `maxMessages` (default 20) most recent messages and summarizes earlier messages. Falls back to sliding window if still over budget after summarization.

```typescript
import { HybridStrategy, SummarizationStrategy } from '@reaatech/session-continuity';

const strategy = new HybridStrategy(
  mySummarizerService,
  new SummarizationStrategy(mySummarizerService)
);
const result = await strategy.compress(
  messages,
  {
    strategy: 'hybrid',
    targetTokens: 3500,
    maxMessages: 20,
    summarizer: mySummarizerService,
  },
  tokenCounter
);
```

### Event System

```typescript
manager.on('session:created', (payload) => {
  console.log(`Session ${payload.sessionId} created`);
});

manager.on('message:added', (payload) => {
  console.log(`Message added to ${payload.sessionId}`);
});

manager.on('compression:applied', (payload) => {
  console.log(`Strategy: ${payload.data.strategy}`);
});

manager.on('agent:handoff', (payload) => {
  console.log(`Session ${payload.sessionId} handed off`);
});
```

Full event list: `session:created`, `session:updated`, `session:ended`, `session:expired`, `session:deleted`, `message:added`, `message:updated`, `message:deleted`, `participant:joined`, `participant:left`, `agent:handoff`, `compression:applied`, `budget:exceeded`, `error`.

### Error Classes

All errors extend `SessionError` which includes `code: string`, `message: string`, and optional `cause?: Error`.

| Class                      | Code                    | Description                             |
| -------------------------- | ----------------------- | --------------------------------------- |
| `SessionError`             | (custom)                | Base class for all session errors       |
| `SessionNotFoundError`     | `SESSION_NOT_FOUND`     | Requested session does not exist        |
| `TokenBudgetExceededError` | `TOKEN_BUDGET_EXCEEDED` | Message would exceed the token budget   |
| `StorageError`             | `STORAGE_ERROR`         | Storage backend error with adapter name |
| `CompressionError`         | `COMPRESSION_ERROR`     | Compression strategy failure            |
| `ValidationError`          | `VALIDATION_ERROR`      | Invalid input or state                  |
| `HandoffError`             | `HANDOFF_ERROR`         | Handoff between agents failed           |

## Export Inventory

**Classes:** `SessionManager`, `SessionRepository`, `SessionEventEmitter`, `MessageWindow`, `TokenBudget`, `SlidingWindowStrategy`, `SummarizationStrategy`, `HybridStrategy`

**Types/Interfaces:** `Session`, `SessionId`, `SessionStatus`, `SessionMetadata`, `Message`, `MessageId`, `MessageRole`, `MessageContent`, `MessageMetadata`, `Participant`, `TokenBudgetConfig`, `TokenCountResult`, `BudgetStatus`, `TokenCounter`, `CompressionConfig`, `CompressionStrategyType`, `CompressionResult`, `ICompressionStrategy`, `SummarizerService`, `IStorageAdapter`, `SessionFilters`, `MessageQueryOptions`, `HealthStatus`, `SessionEvent`, `SessionEventPayload`, `SessionManagerConfig`, `CreateSessionOptions`, `CreateMessageOptions`, `CreateParticipantOptions`, `HandoffContext`, `Logger`

**Error classes:** `SessionError`, `SessionNotFoundError`, `TokenBudgetExceededError`, `StorageError`, `CompressionError`, `ValidationError`, `HandoffError`

**Functions:** `calculateMessageTokens`, `preserveSystemMessages`, `fitMessagesWithinBudget`

## Related Packages

- [`@reaatech/session-continuity-storage-memory`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-memory) — In-memory adapter (dev/testing)
- [`@reaatech/session-continuity-storage-firestore`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-firestore) — Google Cloud Firestore adapter
- [`@reaatech/session-continuity-storage-dynamodb`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-dynamodb) — AWS DynamoDB adapter
- [`@reaatech/session-continuity-storage-redis`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-redis) — Redis adapter
- [`@reaatech/session-continuity-tokenizers`](https://www.npmjs.com/package/@reaatech/session-continuity-tokenizers) — Token counting implementations

## License

[MIT](https://github.com/reaatech/session-continuity-kit/blob/main/LICENSE)
