import { SessionManager } from '@session-continuity-kit/core';
import { DynamoDBAdapter } from '@session-continuity-kit/storage-dynamodb';
import { TiktokenTokenizer } from '@session-continuity-kit/tokenizers';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

async function main() {
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
  );

  const sessionManager = new SessionManager({
    storage: new DynamoDBAdapter({
      client,
      tableName: process.env.DYNAMODB_TABLE || 'sessions',
    }),
    tokenCounter: new TiktokenTokenizer('gpt-4'),
  });

  const session = await sessionManager.createSession({
    userId: 'user-123',
    metadata: { title: 'DynamoDB-backed session' },
  });
  console.log('Created DynamoDB session:', session.id);

  await sessionManager.addMessage(session.id, {
    role: 'user',
    content: 'Hello from DynamoDB!',
  });

  const context = await sessionManager.getConversationContext(session.id);
  console.log('Messages:', context.length);

  await sessionManager.close();
}

main().catch(console.error);
