import { SessionManager } from '@session-continuity-kit/core';
import { MemoryAdapter } from '@session-continuity-kit/storage-memory';
import { TiktokenTokenizer } from '@session-continuity-kit/tokenizers';

async function main() {
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
    sessionTTL: 3600,
  });

  // Create a session
  const session = await sessionManager.createSession({
    userId: 'user-123',
    metadata: { title: 'My Conversation' },
  });
  console.log('Created session:', session.id);

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
  console.log('Context messages:', context.length);

  // End session
  await sessionManager.endSession(session.id);
  console.log('Session ended');

  await sessionManager.close();
}

main().catch(console.error);
