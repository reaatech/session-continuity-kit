# @session-continuity-kit/storage-memory

In-memory storage adapter for development and testing.

## Installation

```bash
npm install @session-continuity-kit/storage-memory
```

## Usage

```typescript
import { MemoryAdapter } from '@session-continuity-kit/storage-memory';

const adapter = new MemoryAdapter({
  ttlMs: 3600000, // Optional TTL simulation
});
```
