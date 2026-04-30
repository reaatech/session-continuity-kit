import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamoDBAdapter } from '../src/DynamoDBAdapter.js';
import type { Session } from '@reaatech/session-continuity';

describe('DynamoDBAdapter', () => {
  let adapter: DynamoDBAdapter;
  let items: Array<Record<string, unknown>> = [];

  function createMockClient() {
    items = [];
    return {
      send: vi.fn(
        async (command: { input: Record<string, unknown>; constructor: { name: string } }) => {
          const name = command.constructor.name;
          const input = command.input;

          if (name === 'PutCommand') {
            const existingIdx = items.findIndex(
              (i) => i.PK === input.Item?.PK && i.SK === input.Item?.SK
            );
            if (existingIdx >= 0) {
              items[existingIdx] = { ...items[existingIdx], ...input.Item };
            } else {
              items.push({ ...input.Item });
            }
            return {};
          }

          if (name === 'GetCommand') {
            const item = items.find((i) => i.PK === input.Key?.PK && i.SK === input.Key?.SK);
            return { Item: item };
          }

          if (name === 'UpdateCommand') {
            const item = items.find((i) => i.PK === input.Key?.PK && i.SK === input.Key?.SK);
            if (item) {
              const values = (input.ExpressionAttributeValues as Record<string, unknown>) ?? {};
              const names = (input.ExpressionAttributeNames as Record<string, string>) ?? {};
              const expr = (input.UpdateExpression as string) ?? '';
              // Parse SET expressions: SET #f0 = :v0, #f1 = :v1
              const setPart = expr.replace(/^SET\s+/, '');
              const assignments = setPart.split(', ');
              for (const assignment of assignments) {
                const [nameAlias, valueAlias] = assignment.split(' = ').map((s) => s.trim());
                const fieldName = names[nameAlias];
                const value = values[valueAlias];
                if (fieldName && value !== undefined) {
                  item[fieldName] = value;
                }
              }
            }
            return { Attributes: item };
          }

          if (name === 'DeleteCommand') {
            items = items.filter((i) => !(i.PK === input.Key?.PK && i.SK === input.Key?.SK));
            return {};
          }

          if (name === 'BatchWriteCommand') {
            const requestItems = input.RequestItems as Record<
              string,
              Array<{ DeleteRequest?: { Key: Record<string, unknown> } }>
            >;
            for (const requests of Object.values(requestItems)) {
              for (const req of requests) {
                const key = req.DeleteRequest?.Key;
                if (key) {
                  items = items.filter((i) => !(i.PK === key.PK && i.SK === key.SK));
                }
              }
            }
            return {};
          }

          if (name === 'QueryCommand') {
            let results = [...items];
            const pkValue = (input.ExpressionAttributeValues as Record<string, unknown>)?.[':pk'];
            if (pkValue) {
              if (input.IndexName === 'GSI1') {
                results = results.filter((i) => i.GSI1PK === pkValue);
              } else if (input.IndexName === 'GSI2') {
                results = results.filter((i) => i.GSI2PK === pkValue);
              } else {
                results = results.filter((i) => i.PK === pkValue);
              }
            }
            const skPrefix = (input.ExpressionAttributeValues as Record<string, unknown>)?.[
              ':skPrefix'
            ];
            if (skPrefix) {
              results = results.filter((i) => (i.SK as string).startsWith(skPrefix as string));
            }
            if (input.Limit) {
              results = results.slice(0, input.Limit as number);
            }
            return { Items: results };
          }

          if (name === 'ScanCommand') {
            let results = [...items];
            const skValue = (input.ExpressionAttributeValues as Record<string, unknown>)?.[':sk'];
            if (skValue) {
              results = results.filter((i) => i.SK === skValue);
            }
            if (input.Limit) {
              results = results.slice(0, input.Limit as number);
            }
            return { Items: results };
          }

          return {};
        }
      ),
    };
  }

  beforeEach(() => {
    const mockClient = createMockClient();
    adapter = new DynamoDBAdapter({
      client: mockClient as unknown as import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient,
      tableName: 'test-table',
    });
  });

  function createSessionData(): Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'> {
    return {
      status: 'active',
      metadata: {},
      participants: [],
      schemaVersion: 1,
    };
  }

  it('creates and retrieves a session', async () => {
    const created = await adapter.createSession(createSessionData());
    expect(created.id).toBeDefined();

    const retrieved = await adapter.getSession(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(created.id);
  });

  it('returns null for missing session', async () => {
    const result = await adapter.getSession('missing');
    expect(result).toBeNull();
  });

  it('updates a session', async () => {
    const created = await adapter.createSession(createSessionData());
    const updated = await adapter.updateSession(created.id, { status: 'completed' });
    expect(updated.status).toBe('completed');
  });

  it('adds and retrieves messages', async () => {
    const session = await adapter.createSession(createSessionData());
    const msg = await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });

    expect(msg.content).toBe('Hello');

    const messages = await adapter.getMessages(session.id);
    expect(messages).toHaveLength(1);
  });

  it('deletes all messages', async () => {
    const session = await adapter.createSession(createSessionData());
    await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });
    await adapter.addMessage(session.id, { role: 'assistant', content: 'Hi' });

    await adapter.deleteAllMessages(session.id);
    const messages = await adapter.getMessages(session.id);
    expect(messages).toHaveLength(0);
  });

  it('updates a message', async () => {
    const session = await adapter.createSession(createSessionData());
    const msg = await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });
    const updated = await adapter.updateMessage(session.id, msg.id, { content: 'Updated' });
    expect(updated.content).toBe('Updated');
  });

  it('deletes a message', async () => {
    const session = await adapter.createSession(createSessionData());
    const msg = await adapter.addMessage(session.id, { role: 'user', content: 'Hello' });
    await adapter.deleteMessage(session.id, msg.id);

    const messages = await adapter.getMessages(session.id);
    expect(messages).toHaveLength(0);
  });

  it('lists sessions with activeAgentId filter', async () => {
    const s1 = await adapter.createSession({ ...createSessionData(), activeAgentId: 'agent-1' });
    await adapter.createSession({ ...createSessionData(), activeAgentId: 'agent-2' });

    const results = await adapter.listSessions({ activeAgentId: 'agent-1' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(s1.id);
  });

  it('returns empty list when no sessions match filters', async () => {
    await adapter.createSession(createSessionData());
    const results = await adapter.listSessions({ userId: 'non-existent' });
    expect(results).toHaveLength(0);
  });

  it('returns expired sessions', async () => {
    const session = await adapter.createSession({
      ...createSessionData(),
      expiresAt: new Date(Date.now() - 1000),
    });
    const expired = await adapter.getExpiredSessions(new Date());
    expect(expired).toContain(session.id);
  });

  it('returns healthy status', async () => {
    const health = await adapter.health();
    expect(health.status).toBe('healthy');
  });

  it('returns healthy on ResourceNotFoundException', async () => {
    const resourceClient = createMockClient();
    resourceClient.send = vi.fn(async () => {
      const err = new Error('Not found');
      (err as any).name = 'ResourceNotFoundException';
      throw err;
    });
    const resourceAdapter = new DynamoDBAdapter({
      client: resourceClient as unknown as import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient,
      tableName: 'test-table',
    });
    const health = await resourceAdapter.health();
    expect(health.status).toBe('healthy');
  });

  it('lists sessions with offset in scan path', async () => {
    await adapter.createSession({ ...createSessionData(), status: 'active' });
    await adapter.createSession({ ...createSessionData(), status: 'active' });
    const results = await adapter.listSessions({ offset: 1 });
    expect(results).toHaveLength(1);
  });

  it('limits messages', async () => {
    const session = await adapter.createSession(createSessionData());
    await adapter.addMessage(session.id, { role: 'user', content: 'A' });
    await adapter.addMessage(session.id, { role: 'user', content: 'B' });
    const messages = await adapter.getMessages(session.id, { limit: 1 });
    expect(messages).toHaveLength(1);
  });

  it('closes without error', async () => {
    await adapter.close();
  });

  it('returns existing session on empty update', async () => {
    const session = await adapter.createSession(createSessionData());
    const updated = await adapter.updateSession(session.id, {});
    expect(updated.id).toBe(session.id);
    expect(updated.status).toBe('active');
  });

  it('throws StorageError on create failure', async () => {
    const failingClient = createMockClient();
    failingClient.send = vi.fn(async () => {
      throw new Error('DB down');
    });
    const failingAdapter = new DynamoDBAdapter({
      client: failingClient as unknown as import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient,
      tableName: 'test-table',
    });

    await expect(failingAdapter.createSession(createSessionData())).rejects.toThrow(
      'Failed to create session'
    );
  });

  it('throws StorageError on get failure', async () => {
    const failingClient = createMockClient();
    failingClient.send = vi.fn(async () => {
      throw new Error('DB down');
    });
    const failingAdapter = new DynamoDBAdapter({
      client: failingClient as unknown as import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient,
      tableName: 'test-table',
    });

    await expect(failingAdapter.getSession('123')).rejects.toThrow('Failed to get session');
  });
});
