# @session-continuity-kit/core

Core abstractions and session management for session-continuity-kit.

## Installation

```bash
npm install @session-continuity-kit/core
```

## Usage

```typescript
import { SessionManager } from '@session-continuity-kit/core';
import { MemoryAdapter } from '@session-continuity-kit/storage-memory';
import { TiktokenTokenizer } from '@session-continuity-kit/tokenizers';

const manager = new SessionManager({
  storage: new MemoryAdapter(),
  tokenCounter: new TiktokenTokenizer('gpt-4'),
  tokenBudget: {
    maxTokens: 4096,
    reserveTokens: 500,
    overflowStrategy: 'compress',
  },
});

const session = await manager.createSession({ userId: 'user-123' });
```

## Exports

- `SessionManager` — Main session orchestrator
- `SessionRepository` — Repository with validation
- `SessionEventEmitter` — Typed event emitter
- `MessageWindow` — Token budget message fitting
- `TokenBudget` — Budget calculations
- `SlidingWindowStrategy`, `SummarizationStrategy`, `HybridStrategy` — Compression strategies
- Types: `Session`, `Message`, `IStorageAdapter`, `TokenCounter`, `SummarizerService`, etc.
