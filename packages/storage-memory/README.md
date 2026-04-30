# @reaatech/session-continuity-storage-memory

[![npm version](https://img.shields.io/npm/v/@reaatech/session-continuity-storage-memory.svg)](https://www.npmjs.com/package/@reaatech/session-continuity-storage-memory)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/session-continuity-kit/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/session-continuity-kit/ci.yml?branch=main&label=CI)](https://github.com/reaatech/session-continuity-kit/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

In-memory storage adapter implementing `IStorageAdapter` from `@reaatech/session-continuity`. Uses `Map`-based storage with optional simulated TTL expiration — ideal for development, testing, and single-process prototypes.

## Installation

```bash
npm install @reaatech/session-continuity-storage-memory
# or
pnpm add @reaatech/session-continuity-storage-memory
```

## Feature Overview

- **Zero dependencies beyond core** — self-contained, no external storage services
- **Implements `IStorageAdapter`** — drop-in replacement for any storage backend
- **Simulated TTL** — configurable expiration via `setTimeout` timers
- **Full query support** — client-side filtering for roles, time ranges, pagination
- **Instant health check** — always returns healthy with zero latency

## Quick Start

```typescript
import { MemoryAdapter } from "@reaatech/session-continuity-storage-memory";
import { SessionManager } from "@reaatech/session-continuity";

const adapter = new MemoryAdapter({ ttlMs: 3600000 }); // 1-hour TTL

const manager = new SessionManager({
  storage: adapter,
  tokenCounter: myTokenCounter,
});

const session = await manager.createSession({ userId: "user-123" });
```

## API Reference

### `MemoryAdapter`

#### Constructor

```typescript
new MemoryAdapter(config?: MemoryAdapterConfig)
```

#### `MemoryAdapterConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `ttlMs` | `number` | — | Simulated TTL in milliseconds. Sessions expire after this period. |

### Public Methods

| Method | Signature | Notes |
|--------|-----------|-------|
| `createSession` | `(session: Omit<Session, "id" \| "createdAt" \| "lastActivityAt">): Promise<Session>` | Auto-generates ID and `expiresAt` from `ttlMs` |
| `getSession` | `(id: SessionId): Promise<Session \| null>` | Lookup from internal `Map` |
| `updateSession` | `(id: SessionId, updates: Partial<Session>): Promise<Session>` | Throws `StorageError` if not found; resets TTL timer |
| `deleteSession` | `(id: SessionId): Promise<void>` | Removes session + messages + clears TTL timer |
| `listSessions` | `(filters?: SessionFilters): Promise<Session[]>` | Client-side filtering; tags use OR semantics |
| `addMessage` | `(sessionId: SessionId, message: ...): Promise<Message>` | Auto-generates ID |
| `getMessages` | `(sessionId: SessionId, options?: MessageQueryOptions): Promise<Message[]>` | Sorted by `createdAt`; supports `roles`, `after`, `before`, `offset`, `limit` |
| `updateMessage` | `(sessionId: SessionId, messageId: MessageId, updates: Partial<Message>): Promise<Message>` | Throws `StorageError` if not found |
| `deleteMessage` | `(sessionId: SessionId, messageId: MessageId): Promise<void>` | — |
| `deleteAllMessages` | `(sessionId: SessionId): Promise<void>` | Clears all messages for a session |
| `getExpiredSessions` | `(before: Date): Promise<SessionId[]>` | Scans `expiresAt` fields |
| `health` | `(): Promise<HealthStatus>` | Always `{ status: "healthy", latency: 0 }` |
| `close` | `(): Promise<void>` | Clears all Maps and timers |

## Usage Patterns

### With SessionManager (TTL + Cleanup)

```typescript
import { MemoryAdapter } from "@reaatech/session-continuity-storage-memory";
import { SessionManager } from "@reaatech/session-continuity";
import { TiktokenTokenizer } from "@reaatech/session-continuity-tokenizers";

const manager = new SessionManager({
  storage: new MemoryAdapter({ ttlMs: 3600000 }),
  tokenCounter: new TiktokenTokenizer("gpt-4"),
  sessionTTL: 3600,
  cleanupInterval: 300, // every 5 minutes
});

const session = await manager.createSession({ userId: "user-123" });
// ... session auto-expires after 1 hour ...
await manager.close(); // clean up timers
```

### Standalone Use

```typescript
import { MemoryAdapter } from "@reaatech/session-continuity-storage-memory";

const adapter = new MemoryAdapter();

const session = await adapter.createSession({
  userId: "test-user",
  status: "active",
  metadata: { title: "Test Session" },
  participants: [],
  schemaVersion: 1,
});

const messages = await adapter.listSessions({ userId: "test-user" });

await adapter.close();
```

## Related Packages

- [`@reaatech/session-continuity`](https://www.npmjs.com/package/@reaatech/session-continuity) — Core types and `IStorageAdapter` interface
- [`@reaatech/session-continuity-storage-firestore`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-firestore) — Production Firestore adapter
- [`@reaatech/session-continuity-storage-dynamodb`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-dynamodb) — Production DynamoDB adapter
- [`@reaatech/session-continuity-storage-redis`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-redis) — Production Redis adapter

## License

[MIT](https://github.com/reaatech/session-continuity-kit/blob/main/LICENSE)
