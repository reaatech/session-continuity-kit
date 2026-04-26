# @session-continuity-kit/storage-redis

Redis storage adapter using hashes and sorted sets.

## Installation

```bash
npm install @session-continuity-kit/storage-redis redis
```

## Usage

```typescript
import { RedisAdapter } from '@session-continuity-kit/storage-redis';
import { createClient } from 'redis';

const client = createClient({ url: 'redis://localhost:6379' });
await client.connect();

const adapter = new RedisAdapter({ client, ttlSeconds: 3600 });
```
