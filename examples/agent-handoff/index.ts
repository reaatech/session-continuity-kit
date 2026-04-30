import { SessionManager } from '@reaatech/session-continuity';
import { MemoryAdapter } from '@reaatech/session-continuity-storage-memory';
import { TiktokenTokenizer } from '@reaatech/session-continuity-tokenizers';

async function main() {
  const sessionManager = new SessionManager({
    storage: new MemoryAdapter(),
    tokenCounter: new TiktokenTokenizer('gpt-4'),
  });

  // Create session handled by Agent A
  const session = await sessionManager.createSession({
    userId: 'user-123',
    activeAgentId: 'agent-A',
  });
  console.log('Session created with agent:', session.activeAgentId);

  // Add some messages
  await sessionManager.addMessage(session.id, {
    role: 'user',
    content: 'I need help with billing',
  });

  // Hand off to Agent B
  await sessionManager.handoffToAgent(session.id, 'agent-B', {
    reason: 'Specialized expertise needed',
    context: { previousAgent: 'agent-A', transferNotes: 'Customer needs billing help' },
  });

  const updated = await sessionManager.getSession(session.id);
  console.log('Session now assigned to:', updated.activeAgentId);

  await sessionManager.close();
}

main().catch(console.error);
