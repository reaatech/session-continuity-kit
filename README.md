# session-continuity-kit

[![npm version](https://img.shields.io/npm/v/@reaatech/session-continuity.svg)](https://www.npmjs.com/package/@reaatech/session-continuity)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

> Multi-turn session management for AI agent systems — extracted from production.

Every AI agent system reinvents session management: conversation history windowing, token budget management, context compression, session persistence, timeout + cleanup, handoff between agents mid-session. This library extracts the pattern.

## Features

- **Session lifecycle** — create, update, end, delete sessions with participants, messages, and metadata
- **Token budget management** — configurable overflow strategies (truncate, compress, error) with `reserveTokens` for LLM responses
- **Context compression** — three strategies: Sliding Window (recent messages), Summarization (LLM-powered summary), Hybrid (recent + summarized)
- **Storage adapters** — Firestore, DynamoDB, Redis, and in-memory backends behind a single `IStorageAdapter` interface
- **Agent handoff** — transfer session ownership between agents mid-conversation with context
- **Event system** — 14 typed session lifecycle events for reactive programming
- **Token counting** — exact (tiktoken, Anthropic) and heuristic estimators with auto-select factory

## Installation

Packages are published under the `@reaatech` scope and can be installed individually:

```bash
# Core session management
pnpm add @reaatech/session-continuity

# Token counting utilities
pnpm add @reaatech/session-continuity-tokenizers

# In-memory storage (dev/testing)
pnpm add @reaatech/session-continuity-storage-memory

# Production storage adapters
pnpm add @reaatech/session-continuity-storage-firestore @google-cloud/firestore
pnpm add @reaatech/session-continuity-storage-dynamodb @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
pnpm add @reaatech/session-continuity-storage-redis redis
```

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
// Returns messages fitted within the token budget
```

See the [`examples/`](./examples/) directory for complete working samples, including compression strategies, storage backends, and agent handoff.

## Packages

| Package                                                                          | Description                                                                            |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`@reaatech/session-continuity`](./packages/core)                                | Core types, SessionManager, compression strategies, event system, error classes        |
| [`@reaatech/session-continuity-tokenizers`](./packages/tokenizers)               | Token counting: tiktoken (OpenAI), Anthropic, heuristic estimator, auto-select factory |
| [`@reaatech/session-continuity-storage-memory`](./packages/storage-memory)       | In-memory storage adapter for development and testing                                  |
| [`@reaatech/session-continuity-storage-firestore`](./packages/storage-firestore) | Google Cloud Firestore adapter with TTL support                                        |
| [`@reaatech/session-continuity-storage-dynamodb`](./packages/storage-dynamodb)   | AWS DynamoDB adapter with single-table design                                          |
| [`@reaatech/session-continuity-storage-redis`](./packages/storage-redis)         | Redis adapter with sorted sets and native TTL                                          |

## Storage Adapters

All adapters implement `IStorageAdapter` — swap backends without changing application code.

### In-Memory (Development/Testing)

```typescript
import { MemoryAdapter } from '@reaatech/session-continuity-storage-memory';

const adapter = new MemoryAdapter({ ttlMs: 3600000 });
```

### Firestore

```typescript
import { FirestoreAdapter } from '@reaatech/session-continuity-storage-firestore';
import { Firestore } from '@google-cloud/firestore';

const adapter = new FirestoreAdapter({ firestore: new Firestore({ projectId: 'my-project' }) });
```

### DynamoDB

```typescript
import { DynamoDBAdapter } from '@reaatech/session-continuity-storage-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const adapter = new DynamoDBAdapter({ client, tableName: 'sessions' });
```

### Redis

```typescript
import { RedisAdapter } from '@reaatech/session-continuity-storage-redis';
import { createClient } from 'redis';

const adapter = new RedisAdapter({
  client: createClient({ url: 'redis://localhost:6379' }),
  ttlSeconds: 3600,
});
```

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — System design, package relationships, and data flows
- [`AGENTS.md`](./AGENTS.md) — Coding conventions and AI agent development guide
- [`DEV_PLAN.md`](./DEV_PLAN.md) — Detailed implementation roadmap
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — Contribution workflow and release process

## Development

```bash
# Clone the repository
git clone https://github.com/reaatech/session-continuity-kit.git
cd session-continuity-kit

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## License

[MIT](LICENSE)

---

Built by [reaatech](https://github.com/reaatech) — extracted from AskGM, REAA voice agent, and voice-agent-kit.
