# @reaatech/session-continuity-storage-redis

[![npm version](https://img.shields.io/npm/v/@reaatech/session-continuity-storage-redis.svg)](https://www.npmjs.com/package/@reaatech/session-continuity-storage-redis)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/session-continuity-kit/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/session-continuity-kit/ci.yml?branch=main&label=CI)](https://github.com/reaatech/session-continuity-kit/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Redis storage adapter implementing `IStorageAdapter` from `@reaatech/session-continuity`. Uses hashes for session/metadata, sorted sets for message ordering, and native `EXPIRE` for TTL — ideal for low-latency, high-throughput deployments.

## Installation

```bash
npm install @reaatech/session-continuity-storage-redis redis
# or
pnpm add @reaatech/session-continuity-storage-redis redis
```

## Feature Overview

- **Implements `IStorageAdapter`** — drop-in replacement for any storage backend
- **Sorted set message ordering** — messages scored by `createdAt`; supports `offset`, `limit`, and direction (`asc`/`desc`)
- **Native Redis TTL** — `EXPIRE` applied to session hashes and message keys
- **User index** — fast user-based lookups via a Redis Set (`user:{userId}:sessions`)
- **Content type preservation** — round-trips both plain text and structured `MessageContent` correctly

## Quick Start

```typescript
import { RedisAdapter } from '@reaatech/session-continuity-storage-redis';
import { SessionManager } from '@reaatech/session-continuity';
import { createClient } from 'redis';

const redis = createClient({ url: 'redis://localhost:6379' });
await redis.connect();

const manager = new SessionManager({
  storage: new RedisAdapter({ client: redis, ttlSeconds: 3600 }),
  tokenCounter: myTokenCounter,
});
```

## API Reference

### `RedisAdapter`

#### Constructor

```typescript
new RedisAdapter(config: RedisAdapterConfig)
```

#### `RedisAdapterConfig`

| Property     | Type              | Default    | Description                                      |
| ------------ | ----------------- | ---------- | ------------------------------------------------ |
| `client`     | `RedisClientType` | (required) | node-redis v4+ client instance                   |
| `ttlSeconds` | `number`          | —          | Default TTL in seconds for sessions and messages |

### Key Design

| Key Pattern              | Type       | Description                                 |
| ------------------------ | ---------- | ------------------------------------------- |
| `session:{id}`           | Hash       | Session fields                              |
| `session:{id}:messages`  | Sorted Set | Message IDs scored by `createdAt.getTime()` |
| `message:{id}`           | Hash       | Message fields                              |
| `user:{userId}:sessions` | Set        | Session IDs for a user (index)              |

### Public Methods

| Method                                         | Notes                                                                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createSession(session)`                       | Stores as hash; optional `EXPIRE`; adds to user index if `userId` present                                                                                         |
| `getSession(id)`                               | `HGETALL` — returns `null` if hash is empty                                                                                                                       |
| `updateSession(id, updates)`                   | Replaces hash (DEL + HSET) to clear removed fields; resets TTL; updates user index if `userId` changed                                                            |
| `deleteSession(id)`                            | Removes from user index, deletes all messages, deletes session hash                                                                                               |
| `listSessions(filters?)`                       | Uses user index for fast userId-only lookups; otherwise SCANs `session:*`. Tags filtered client-side (OR semantics)                                               |
| `addMessage(sessionId, message)`               | Adds to sorted set + creates message hash; applies TTL if configured                                                                                              |
| `getMessages(sessionId, options?)`             | **Note:** `after` and `before` not supported. Uses `ZRANGE`/`ZREVRANGE` for `offset`/`limit`/`order`. Role filtering is client-side and applied after pagination. |
| `updateMessage(sessionId, messageId, updates)` | TSets message hash; throws `StorageError` if not found                                                                                                            |
| `deleteMessage(sessionId, messageId)`          | Removes from sorted set + deletes message hash                                                                                                                    |
| `deleteAllMessages(sessionId)`                 | Pipelines DEL commands for all message IDs + sorted set                                                                                                           |
| `getExpiredSessions(before)`                   | Scans `session:*` keys and checks `expiresAt` in each hash                                                                                                        |
| `health()`                                     | `PING`                                                                                                                                                            |
| `close()`                                      | `client.quit()`                                                                                                                                                   |

All methods throw `StorageError("redis")` on failure.

### Content Type Handling

The adapter preserves the content type of messages to correctly round-trip both plain text strings and structured multi-modal content arrays. An internal `contentType` field (`"string"` or `"json"`) is stored alongside the content.

## Usage Patterns

### With Connection Management

```typescript
import { createClient } from 'redis';
import { RedisAdapter } from '@reaatech/session-continuity-storage-redis';

const redis = createClient({ url: 'redis://localhost:6379' });

redis.on('error', (err) => console.error('Redis client error', err));
await redis.connect();

const adapter = new RedisAdapter({ client: redis, ttlSeconds: 7200 });

// Graceful shutdown
process.on('SIGTERM', async () => {
  await adapter.close();
  process.exit(0);
});
```

### With SessionManager and Cleanup

```typescript
import { SessionManager } from '@reaatech/session-continuity';
import { RedisAdapter } from '@reaatech/session-continuity-storage-redis';
import { TiktokenTokenizer } from '@reaatech/session-continuity-tokenizers';

const manager = new SessionManager({
  storage: new RedisAdapter({ client: redis, ttlSeconds: 3600 }),
  tokenCounter: new TiktokenTokenizer('gpt-4'),
  sessionTTL: 3600,
  cleanupInterval: 300,
});

// Redis TTL handles expiration natively;
// cleanupInterval provides application-level backup
```

## Related Packages

- [`@reaatech/session-continuity`](https://www.npmjs.com/package/@reaatech/session-continuity) — Core types and `IStorageAdapter` interface
- [`@reaatech/session-continuity-storage-memory`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-memory) — In-memory adapter (dev/testing)
- [`@reaatech/session-continuity-storage-firestore`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-firestore) — Production Firestore adapter
- [`@reaatech/session-continuity-storage-dynamodb`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-dynamodb) — Production DynamoDB adapter

## License

[MIT](https://github.com/reaatech/session-continuity-kit/blob/main/LICENSE)
