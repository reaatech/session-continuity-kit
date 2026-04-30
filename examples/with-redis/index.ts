import { SessionManager } from '@reaatech/session-continuity';
import { RedisAdapter } from '@reaatech/session-continuity-storage-redis';
import { TiktokenTokenizer } from '@reaatech/session-continuity-tokenizers';
import { createClient } from 'redis';

async function main() {
  const client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  await client.connect();

  const sessionManager = new SessionManager({
    storage: new RedisAdapter({ client, ttlSeconds: 3600 }),
    tokenCounter: new TiktokenTokenizer('gpt-4'),
  });

  const session = await sessionManager.createSession({
    userId: 'user-123',
    metadata: { title: 'Redis-backed session' },
  });
  console.log('Created Redis session:', session.id);

  await sessionManager.addMessage(session.id, {
    role: 'user',
    content: 'Hello from Redis!',
  });

  const context = await sessionManager.getConversationContext(session.id);
  console.log('Messages:', context.length);

  await sessionManager.close();
}

main().catch(console.error);
