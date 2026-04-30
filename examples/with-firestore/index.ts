import { SessionManager } from '@reaatech/session-continuity';
import { FirestoreAdapter } from '@reaatech/session-continuity-storage-firestore';
import { TiktokenTokenizer } from '@reaatech/session-continuity-tokenizers';
import { Firestore } from '@google-cloud/firestore';

async function main() {
  const firestore = new Firestore({
    projectId: process.env.GCP_PROJECT_ID,
  });

  const sessionManager = new SessionManager({
    storage: new FirestoreAdapter({ firestore }),
    tokenCounter: new TiktokenTokenizer('gpt-4'),
  });

  const session = await sessionManager.createSession({
    userId: 'user-123',
    metadata: { title: 'Firestore-backed session' },
  });
  console.log('Created Firestore session:', session.id);

  await sessionManager.addMessage(session.id, {
    role: 'user',
    content: 'Hello from Firestore!',
  });

  const context = await sessionManager.getConversationContext(session.id);
  console.log('Messages:', context.length);

  await sessionManager.close();
}

main().catch(console.error);
