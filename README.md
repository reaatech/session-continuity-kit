# Session Continuity Kit

> **Multi-turn session management for AI agent systems — extracted from production.**

[![npm version](https://img.shields.io/npm/v/session-continuity-kit.svg)](https://www.npmjs.com/package/session-continuity-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

Every AI agent system reinvents session management: conversation history windowing, token budget management, context compression, session persistence, timeout + cleanup, handoff between agents mid-session. We've built this at least three times (AskGM, REAA voice agent, voice-agent-kit). This library extracts the pattern.

## Features

- **🔄 Multi-turn Sessions** — Full session lifecycle management with participants, messages, and metadata
- **💰 Token Budget Management** — First-class support for LLM token budgets with configurable overflow strategies
- **🗜️ Context Compression** — Three strategies: Sliding Window, Summarization, and Hybrid
- **💾 Storage Adapters** — Firestore, DynamoDB, Redis, and in-memory implementations
- **⏱️ TTL & Cleanup** — Automatic session expiration and cleanup jobs
- **🤝 Agent Handoff** — Seamless handoff between agents mid-session
- **📡 Event System** — Typed events for reactive programming
- **🔒 Type-Safe** — Full TypeScript support with strict types

## Installation

```bash
npm install @session-continuity-kit/core
# or
pnpm add @session-continuity-kit/core
# or
yarn add @session-continuity-kit/core
```

### Optional Storage Adapters

```bash
# For Firestore
npm install @session-continuity-kit/storage-firestore @google-cloud/firestore

# For DynamoDB
npm install @session-continuity-kit/storage-dynamodb @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb

# For Redis
npm install @session-continuity-kit/storage-redis redis
```

## Quick Start

```typescript
import { SessionManager } from '@session-continuity-kit/core';
import { MemoryAdapter } from '@session-continuity-kit/storage-memory';
import { TiktokenTokenizer } from '@session-continuity-kit/tokenizers';

// Create session manager with in-memory storage
const sessionManager = new SessionManager({
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
  sessionTTL: 3600, // 1 hour
});

// Create a session
const session = await sessionManager.createSession({
  userId: 'user-123',
  metadata: { title: 'My Conversation' },
});

// Add messages
await sessionManager.addMessage(session.id, {
  role: 'user',
  content: 'Hello, how are you?',
});

await sessionManager.addMessage(session.id, {
  role: 'assistant',
  content: 'I am doing well, thank you! How can I help you today?',
});

// Get context for LLM (auto-compressed if needed)
const context = await sessionManager.getConversationContext(session.id);
console.log(context); // Messages within token budget

// End session
await sessionManager.endSession(session.id);
```

## Storage Adapters

### In-Memory (Development/Testing)

```typescript
import { MemoryAdapter } from '@session-continuity-kit/storage-memory';

const adapter = new MemoryAdapter({
  ttlMs: 3600000, // Optional TTL simulation in milliseconds
});
```

### Firestore

```typescript
import { FirestoreAdapter } from '@session-continuity-kit/storage-firestore';
import { Firestore } from '@google-cloud/firestore';

const firestore = new Firestore({ projectId: 'my-project' });
const adapter = new FirestoreAdapter({ firestore });
```

### DynamoDB

```typescript
import { DynamoDBAdapter } from '@session-continuity-kit/storage-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const adapter = new DynamoDBAdapter({ client, tableName: 'sessions' });
```

### Redis

```typescript
import { RedisAdapter } from '@session-continuity-kit/storage-redis';
import { createClient } from 'redis';

const redis = createClient({ url: 'redis://localhost:6379' });
const adapter = new RedisAdapter({ client: redis, ttlSeconds: 3600 });
```

## Compression Strategies

### Sliding Window

Keeps the most recent messages that fit within the token budget.

```typescript
const sessionManager = new SessionManager({
  // ... other config
  compression: {
    strategy: 'sliding_window',
    targetTokens: 3500,
    maxMessages: 50,
  },
});
```

**Best for:** Short conversations, when exact history is critical, when LLM summarization is too expensive.

### Summarization

Uses an LLM to summarize older messages into a condensed summary.

```typescript
import { SummarizationStrategy } from '@session-continuity-kit/core';
// You need to provide your own SummarizerService implementation

const sessionManager = new SessionManager({
  // ... other config
  compression: {
    strategy: 'summarization',
    targetTokens: 3500,
    summarizationPrompt: 'Summarize the key points of this conversation in 2-3 sentences.',
    summarizationModel: 'gpt-3.5-turbo',
  },
});
```

**Best for:** Long-running conversations, when semantic context is more important than exact details.

### Hybrid

Combines sliding window for recent messages and summarization for older context.

```typescript
const sessionManager = new SessionManager({
  // ... other config
  compression: {
    strategy: 'hybrid',
    targetTokens: 3500,
    maxMessages: 20, // Keep last 20 messages as-is
    summarizationPrompt: 'Summarize the earlier part of this conversation.',
  },
});
```

**Best for:** Most production use cases — provides both recent detail and historical context.

## Token Counting

### OpenAI Models (Tiktoken)

```typescript
import { TiktokenTokenizer } from '@session-continuity-kit/tokenizers';

const tokenizer = new TiktokenTokenizer('gpt-4');
const count = tokenizer.count('Hello, world!');
```

### Anthropic Models

```typescript
import { AnthropicTokenizer } from '@session-continuity-kit/tokenizers';

const tokenizer = new AnthropicTokenizer('claude-3-sonnet');
const count = tokenizer.count('Hello, world!');
```

### Fast Estimation

```typescript
import { EstimateTokenizer } from '@session-continuity-kit/tokenizers';

const tokenizer = new EstimateTokenizer(4); // ~4 chars per token
const count = tokenizer.count('Hello, world!');
```

## Agent Handoff

Seamlessly transfer session ownership between agents:

```typescript
// Agent A is handling the session
await sessionManager.handoffToAgent(sessionId, 'agent-B', {
  reason: 'Specialized expertise needed',
  context: { previousAgent: 'agent-A', transferNotes: 'Customer needs billing help' },
});

// Session is now assigned to Agent B
const session = await sessionManager.getSession(sessionId);
console.log(session.activeAgentId); // 'agent-B'
```

## Event System

Subscribe to session events for reactive programming:

```typescript
sessionManager.on('session:created', (event) => {
  console.log(`Session ${event.sessionId} created`);
});

sessionManager.on('message:added', (event) => {
  console.log(`Message added to session ${event.sessionId}`);
});

sessionManager.on('compression:applied', (event) => {
  console.log(`Compression applied: ${event.data.strategy}`);
});

sessionManager.on('budget:exceeded', (event) => {
  console.log(`Budget exceeded in session ${event.sessionId}`);
});
```

## Configuration

### SessionManagerConfig

```typescript
interface SessionManagerConfig {
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

  /** Logger (defaults to a no-op logger) */
  logger?: Logger;
}
```

## Documentation

- [Development Plan](./DEV_PLAN.md) — Detailed implementation roadmap
- [Architecture](./ARCHITECTURE.md) — Deep dive into design decisions
- [Agent Skills](./AGENTS.md) — AI agent development guide

## Examples

See the [examples](./examples) directory for runnable examples:

- `basic-usage` — Simple in-memory example
- `with-compression` — Context compression demo
- `with-dynamodb` — DynamoDB integration
- `with-firestore` — Firestore integration
- `with-redis` — Redis integration
- `agent-handoff` — Multi-agent handoff example

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

# Run tests with coverage
pnpm test:coverage
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License — see [LICENSE](./LICENSE) for details.

## Acknowledgments

This library was extracted from real-world implementations:

- **AskGM** — AI-powered Q&A system
- **REAA voice agent** — Voice-based AI assistant
- **voice-agent-kit** — Voice agent framework

Built with ❤️ by [reaatech](https://github.com/reaatech)
