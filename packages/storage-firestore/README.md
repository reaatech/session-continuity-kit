# @reaatech/session-continuity-storage-firestore

[![npm version](https://img.shields.io/npm/v/@reaatech/session-continuity-storage-firestore.svg)](https://www.npmjs.com/package/@reaatech/session-continuity-storage-firestore)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/session-continuity-kit/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/session-continuity-kit/ci.yml?branch=main&label=CI)](https://github.com/reaatech/session-continuity-kit/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Google Cloud Firestore storage adapter implementing `IStorageAdapter` from `@reaatech/session-continuity`. Uses a collection for sessions with a message subcollection — ideal for serverless and GCP-native deployments.

## Installation

```bash
npm install @reaatech/session-continuity-storage-firestore @google-cloud/firestore
# or
pnpm add @reaatech/session-continuity-storage-firestore @google-cloud/firestore
```

## Feature Overview

- **Implements `IStorageAdapter`** — drop-in replacement for any storage backend
- **Firestore TTL policies** — native document expiration via a configurable TTL field
- **Batch operations** — messages deleted in batches of 500 for efficiency
- **Server-side filtering** — uses Firestore `where()` queries for user, status, and agent filters
- **No connection management** — `close()` is a no-op (Firestore manages its own connection pool)

## Quick Start

```typescript
import { FirestoreAdapter } from "@reaatech/session-continuity-storage-firestore";
import { SessionManager } from "@reaatech/session-continuity";
import { Firestore } from "@google-cloud/firestore";

const firestore = new Firestore({ projectId: "my-project" });

const manager = new SessionManager({
  storage: new FirestoreAdapter({ firestore }),
  tokenCounter: myTokenCounter,
});
```

## API Reference

### `FirestoreAdapter`

#### Constructor

```typescript
new FirestoreAdapter(config: FirestoreAdapterConfig)
```

#### `FirestoreAdapterConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `firestore` | `Firestore` | (required) | Google Cloud Firestore instance |
| `ttlField` | `string` | `"expiresAt"` | Field name used for Firestore TTL policy |

### Data Model

```
sessions (collection)
  ├── {sessionId} (document)     — session metadata + fields
  └── messages (subcollection)
      └── {messageId} (document) — individual messages
```

### Public Methods

| Method | Notes |
|--------|-------|
| `createSession(session)` | Auto-generates doc ID; serializes Dates to Firestore Timestamps |
| `getSession(id)` | — |
| `updateSession(id, updates)` | Re-reads after update to return current state |
| `deleteSession(id)` | Batch-deletes all messages (chunks of 500), then deletes session doc |
| `listSessions(filters?)` | Server-side `where()` for `userId`, `status`, `activeAgentId`; tags filtered client-side (OR semantics); supports `limit` and `offset` |
| `addMessage(sessionId, message)` | Subcollection doc with auto-generated ID |
| `getMessages(sessionId, options?)` | Orders by `createdAt`; roles filtered client-side; supports `after`, `before`, `offset`, `limit` |
| `updateMessage(sessionId, messageId, updates)` | Re-reads after update |
| `deleteMessage(sessionId, messageId)` | — |
| `deleteAllMessages(sessionId)` | Batch deletes in chunks of 500 |
| `getExpiredSessions(before)` | Queries `ttlField < before` |
| `health()` | Lightweight `limit(1).get()` ping |
| `close()` | No-op (Firestore manages its own pool) |

All methods throw `StorageError("firestore")` on failure.

### Firestore TTL

Configure a Firestore TTL policy on the `expiresAt` field (default) to enable native document expiration:

```typescript
// Custom TTL field name
const adapter = new FirestoreAdapter({
  firestore,
  ttlField: "deleteAt", // Set a Firestore TTL policy on this field
});
```

Without a TTL policy, the `cleanupExpiredSessions()` method on `SessionManager` handles deletion in application code.

## Related Packages

- [`@reaatech/session-continuity`](https://www.npmjs.com/package/@reaatech/session-continuity) — Core types and `IStorageAdapter` interface
- [`@reaatech/session-continuity-storage-memory`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-memory) — In-memory adapter (dev/testing)
- [`@reaatech/session-continuity-storage-dynamodb`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-dynamodb) — AWS DynamoDB adapter
- [`@reaatech/session-continuity-storage-redis`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-redis) — Redis adapter

## License

[MIT](https://github.com/reaatech/session-continuity-kit/blob/main/LICENSE)
