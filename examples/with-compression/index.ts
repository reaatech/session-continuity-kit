import { SessionManager } from '@session-continuity-kit/core';
import { MemoryAdapter } from '@session-continuity-kit/storage-memory';
import { TiktokenTokenizer } from '@session-continuity-kit/tokenizers';

async function main() {
  const sessionManager = new SessionManager({
    storage: new MemoryAdapter(),
    tokenCounter: new TiktokenTokenizer('gpt-4'),
    tokenBudget: {
      maxTokens: 2048,
      reserveTokens: 200,
      overflowStrategy: 'compress',
    },
    compression: {
      strategy: 'sliding_window',
      targetTokens: 1800,
      maxMessages: 50,
    },
  });

  const session = await sessionManager.createSession({
    userId: 'user-123',
  });

  // Add many messages to trigger compression
  for (let i = 0; i < 20; i++) {
    await sessionManager.addMessage(session.id, {
      role: 'user',
      content: `This is message ${i} with some content to fill up tokens. `.repeat(10),
    });
    await sessionManager.addMessage(session.id, {
      role: 'assistant',
      content: `Response ${i}: Acknowledged. `.repeat(10),
    });
  }

  const context = await sessionManager.getConversationContext(session.id);
  console.log('Original messages: 40');
  console.log('Compressed context messages:', context.length);

  await sessionManager.close();
}

main().catch(console.error);
