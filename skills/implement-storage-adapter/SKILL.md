# Skill: Implement Storage Adapter

## Purpose

Build storage adapter implementations for session persistence: `MemoryAdapter`, `FirestoreAdapter`, `DynamoDBAdapter`, and `RedisAdapter`.

## When to Use

- Phase 3 implementation
- When adding a new storage backend

## Prerequisites

- `IStorageAdapter` interface is defined and compiling
- Core types (Session, Message) are stable

## Step-by-Step Instructions

### 1. Implement `MemoryAdapter` First

File: `packages/storage-memory/src/MemoryAdapter.ts`

- Use `Map<string, Session>` and `Map<string, Message[]>` for storage
- Implement all `IStorageAdapter` methods
- Support optional TTL simulation using `setTimeout` / `Date` checks
- `listSessions`: filter in-memory with simple array filters
- `getExpiredSessions`: scan sessions and check `expiresAt`
- `health`: always return `healthy`
- `close`: clear maps (optional)

This adapter is the reference implementation — make it clean and well-tested.

### 2. Implement `FirestoreAdapter`

File: `packages/storage-firestore/src/FirestoreAdapter.ts`

- Use subcollection pattern: `sessions/{id}/messages`
- Serialize `Date` ↔ `Timestamp`
- Use Firestore TTL policy field (`__ttl` or `expiresAt` as Timestamp)
- `listSessions`: use collection queries with `.where()`; note that Firestore requires composite indexes for multi-field queries
- `getMessages`: order by `createdAt`, support `limit`, `after`, `before`
- Batch writes when possible for `deleteAllMessages`

### 3. Implement `DynamoDBAdapter`

File: `packages/storage-dynamodb/src/DynamoDBAdapter.ts`

- Single-table design:
  - PK=`SESSION#{sessionId}`, SK=`META`
  - PK=`SESSION#{sessionId}`, SK=`MSG#{timestamp}#{messageId}`
  - GSI1 PK=`USER#{userId}`, SK=`CREATED_AT#{timestamp}` (for `listSessions` by user)
  - GSI2 PK=`AGENT#{agentId}`, SK=`STATUS#{status}` (for `listSessions` by agent)
- TTL attribute as Unix epoch seconds
- `listSessions`: query the appropriate GSI based on which filter is provided; if multiple filters provided, query the most selective GSI and filter client-side
- `updateSession`: use `UpdateItem` with `ExpressionAttributeNames`/`Values`

### 4. Implement `RedisAdapter`

File: `packages/storage-redis/src/RedisAdapter.ts`

- Session metadata: Redis Hash at `session:{id}`
- Messages: Redis Sorted Set at `session:{id}:messages` (score = timestamp); message body stored as separate Hash at `message:{messageId}`
- TTL: `EXPIRE` on session hash; for messages, you can either set TTL individually or rely on session cleanup
- **CRITICAL**: `listSessions` with arbitrary filters (`userId`, `status`, `tags`, date ranges) is **not efficiently supported** in Redis.
  - Implement `listSessions` as a **best-effort** scan using `SCAN` + client-side filtering
  - Document this limitation clearly in JSDoc
  - If `userId` filter is common, maintain a secondary index: `user:{userId}:sessions` as a Set
- `getMessages`: use `zRange` or `zRevRange` based on `order`
- Connection management with reconnection strategy

### 5. Adapter-Specific Types

Each adapter package should have:

- `types.ts` for config interfaces (e.g., `FirestoreConfig`, `RedisConfig`)
- `index.ts` exporting the adapter and config types

### 6. Integration Tests

Each adapter package needs:

- `tests/<Adapter>.test.ts`
- Tests for CRUD, queries, TTL, health, and close
- For Firestore/DynamoDB/Redis, use testcontainers or emulator if possible; otherwise use mocked clients

## Validation

- [ ] All adapters implement `IStorageAdapter` with no TypeScript errors
- [ ] `MemoryAdapter` has full test coverage
- [ ] Redis adapter JSDoc documents `listSessions` limitations
- [ ] DynamoDB adapter uses single-table design as specified
- [ ] Firestore adapter serializes dates correctly
- [ ] Health checks return proper latency for real adapters
- [ ] `close()` cleans up connections

## Common Pitfalls

- **Do NOT** forget to deserialize Dates from storage — adapters receive strings/Timestamps/numbers, not `Date` objects
- **Do NOT** implement `listSessions` in Redis with `KEYS *` — use `SCAN` or document limitations
- **Do NOT** forget TTL attribute naming for DynamoDB (must be a top-level numeric attribute)
- **Do NOT** leak connection errors as raw vendor errors — wrap in `StorageError`
- **Do NOT** forget to handle `null`/`undefined` fields during serialization (e.g., `leftAt` on Participant)
