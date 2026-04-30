# @reaatech/session-continuity-storage-dynamodb

[![npm version](https://img.shields.io/npm/v/@reaatech/session-continuity-storage-dynamodb.svg)](https://www.npmjs.com/package/@reaatech/session-continuity-storage-dynamodb)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/session-continuity-kit/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/session-continuity-kit/ci.yml?branch=main&label=CI)](https://github.com/reaatech/session-continuity-kit/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

AWS DynamoDB storage adapter implementing `IStorageAdapter` from `@reaatech/session-continuity`. Uses a single-table design with composite keys and two global secondary indexes (GSIs) for efficient querying — ideal for serverless and AWS-native deployments.

## Installation

```bash
npm install @reaatech/session-continuity-storage-dynamodb @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
# or
pnpm add @reaatech/session-continuity-storage-dynamodb @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

## Feature Overview

- **Implements `IStorageAdapter`** — drop-in replacement for any storage backend
- **Single-table design** — sessions and messages coexist in one DynamoDB table with type-prefixed keys
- **Two GSIs** — query by user (GSI1) and by agent + status (GSI2) without full table scans
- **DynamoDB TTL** — native `expiresAt` as a Unix timestamp attribute for automatic cleanup
- **Dynamic updates** — `updateSession` builds `UpdateExpression` from changed fields only
- **Batch operations** — messages deleted in chunks of 25 (DynamoDB batch write limit)

## Quick Start

```typescript
import { DynamoDBAdapter } from '@reaatech/session-continuity-storage-dynamodb';
import { SessionManager } from '@reaatech/session-continuity';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

const manager = new SessionManager({
  storage: new DynamoDBAdapter({ client: ddbClient, tableName: 'sessions' }),
  tokenCounter: myTokenCounter,
});
```

## API Reference

### `DynamoDBAdapter`

#### Constructor

```typescript
new DynamoDBAdapter(config: DynamoDBAdapterConfig)
```

#### `DynamoDBAdapterConfig`

| Property    | Type                     | Default    | Description                         |
| ----------- | ------------------------ | ---------- | ----------------------------------- |
| `client`    | `DynamoDBDocumentClient` | (required) | AWS SDK v3 DynamoDB Document Client |
| `tableName` | `string`                 | (required) | Target DynamoDB table name          |

### Single-Table Design

| Entity           | PK                    | SK                            |
| ---------------- | --------------------- | ----------------------------- |
| Session metadata | `SESSION#{id}`        | `META`                        |
| Message          | `SESSION#{sessionId}` | `MSG#{createdAt}#{messageId}` |

**GSI1** (user index): PK=`USER#{userId}`, SK=`CREATED_AT#{timestamp}`

**GSI2** (agent index): PK=`AGENT#{activeAgentId}`, SK=`STATUS#{status}`

### Public Methods

| Method                                         | Notes                                                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `createSession(session)`                       | `ConditionExpression` prevents overwrite; sets TTL attribute as Unix timestamp                                             |
| `getSession(id)`                               | Get by PK=`SESSION#{id}`, SK=`META`                                                                                        |
| `updateSession(id, updates)`                   | Dynamic `UpdateExpression`; updates GSI keys if `userId`, `status`, or `activeAgentId` change                              |
| `deleteSession(id)`                            | Deletes all messages first, then the session                                                                               |
| `listSessions(filters?)`                       | Uses GSI1 for `userId`, GSI2 for `agentId`; falls back to Scan for other filters; tags filtered client-side (OR semantics) |
| `addMessage(sessionId, message)`               | SK = `MSG#{isoTimestamp}#{uuid}`                                                                                           |
| `getMessages(sessionId, options?)`             | **Note:** `after` and `before` not supported. Paginates across 1MB limits via `LastEvaluatedKey`                           |
| `updateMessage(sessionId, messageId, updates)` | Must scan messages to locate by ID (SK embeds `createdAt` time, not messageId)                                             |
| `deleteMessage(sessionId, messageId)`          | Same scan requirement as `updateMessage`                                                                                   |
| `deleteAllMessages(sessionId)`                 | Batch writes in chunks of 25                                                                                               |
| `getExpiredSessions(before)`                   | Scan on TTL attribute < before                                                                                             |
| `health()`                                     | GET on `HEALTH#CHECK`/`CHECK`; tolerates `ResourceNotFoundException` as healthy                                            |
| `close()`                                      | No-op (client is stateless in SDK v3)                                                                                      |

All methods throw `StorageError("dynamodb")` on failure.

### Table Setup

The adapter expects a table with the following schema:

```yaml
TableName: sessions
KeySchema:
  - AttributeName: PK
    KeyType: HASH
  - AttributeName: SK
    KeyType: RANGE
GlobalSecondaryIndexes:
  - IndexName: GSI1
    KeySchema:
      - AttributeName: GSI1PK
        KeyType: HASH
      - AttributeName: GSI1SK
        KeyType: RANGE
    Projection: ALL
  - IndexName: GSI2
    KeySchema:
      - AttributeName: GSI2PK
        KeyType: HASH
      - AttributeName: GSI2SK
        KeyType: RANGE
    Projection: ALL
TTL:
  AttributeName: ttl
  Enabled: true
```

## Related Packages

- [`@reaatech/session-continuity`](https://www.npmjs.com/package/@reaatech/session-continuity) — Core types and `IStorageAdapter` interface
- [`@reaatech/session-continuity-storage-memory`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-memory) — In-memory adapter (dev/testing)
- [`@reaatech/session-continuity-storage-firestore`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-firestore) — Production Firestore adapter
- [`@reaatech/session-continuity-storage-redis`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-redis) — Production Redis adapter

## License

[MIT](https://github.com/reaatech/session-continuity-kit/blob/main/LICENSE)
