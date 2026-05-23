import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamoDBAdapter } from '../src/DynamoDBAdapter.js';
import { ConcurrencyError } from '@reaatech/session-continuity';
import type { Session } from '@reaatech/session-continuity';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Mock DynamoDB client that honors `ConditionExpression` for the optimistic
 * concurrency check (`attribute_not_exists(#cv) OR #cv = :cv`), throwing a
 * ConditionalCheckFailedException with ALL_OLD attributes on conflict.
 */
function createCasClient() {
  const items: Array<Record<string, unknown>> = [];
  return {
    items,
    send: vi.fn(
      async (command: { input: Record<string, unknown>; constructor: { name: string } }) => {
        const name = command.constructor.name;
        const input = command.input;

        if (name === 'PutCommand') {
          items.push({ ...(input.Item as Record<string, unknown>) });
          return {};
        }

        if (name === 'GetCommand') {
          const item = items.find((i) => i.PK === input.Key?.PK && i.SK === input.Key?.SK);
          return { Item: item };
        }

        if (name === 'UpdateCommand') {
          const item = items.find((i) => i.PK === input.Key?.PK && i.SK === input.Key?.SK);
          const names = (input.ExpressionAttributeNames as Record<string, string>) ?? {};
          const values = (input.ExpressionAttributeValues as Record<string, unknown>) ?? {};

          // Evaluate the optimistic-concurrency condition, if present.
          if (input.ConditionExpression && item) {
            const expectedAlias = Object.keys(names).find((a) => names[a] === 'version');
            const expected = expectedAlias ? values[':cv'] : undefined;
            const hasVersion = item.version !== undefined;
            const passes = !hasVersion || item.version === expected;
            if (!passes) {
              const err = new Error('The conditional request failed');
              (err as Error).name = 'ConditionalCheckFailedException';
              (err as unknown as { Item: Record<string, unknown> }).Item = { ...item };
              throw err;
            }
          }

          if (item) {
            const expr = (input.UpdateExpression as string) ?? '';
            const setPart = expr.replace(/^SET\s+/, '');
            for (const assignment of setPart.split(', ')) {
              const [nameAlias, valueAlias] = assignment.split(' = ').map((s) => s.trim());
              const fieldName = names[nameAlias];
              const value = values[valueAlias];
              if (fieldName && value !== undefined) item[fieldName] = value;
            }
          }
          return { Attributes: item };
        }

        return {};
      }
    ),
  };
}

describe('DynamoDBAdapter — optimistic concurrency (#3)', () => {
  let client: ReturnType<typeof createCasClient>;
  let adapter: DynamoDBAdapter;

  beforeEach(() => {
    client = createCasClient();
    adapter = new DynamoDBAdapter({
      client: client as unknown as DynamoDBDocumentClient,
      tableName: 'test-table',
    });
  });

  function sessionData(): Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'> {
    return { status: 'active', metadata: {}, participants: [], schemaVersion: 1, version: 1 };
  }

  it('rejects a stale conditional write with ConcurrencyError', async () => {
    const s = await adapter.createSession(sessionData());
    // A concurrent writer advances the version first.
    await adapter.updateSession(s.id, { status: 'paused', version: 2 }, { expectedVersion: 1 });
    // A writer still holding version 1 is rejected.
    await expect(
      adapter.updateSession(s.id, { status: 'completed', version: 2 }, { expectedVersion: 1 })
    ).rejects.toThrow(ConcurrencyError);
  });

  it('reports the actual stored version on conflict', async () => {
    const s = await adapter.createSession(sessionData());
    await adapter.updateSession(s.id, { status: 'paused', version: 2 }, { expectedVersion: 1 });
    await expect(
      adapter.updateSession(s.id, { status: 'completed' }, { expectedVersion: 1 })
    ).rejects.toMatchObject({ expectedVersion: 1, actualVersion: 2 });
  });

  it('accepts a conditional write when the version matches', async () => {
    const s = await adapter.createSession(sessionData());
    const updated = await adapter.updateSession(
      s.id,
      { status: 'completed', version: 2 },
      { expectedVersion: 1 }
    );
    expect(updated.status).toBe('completed');
    expect(updated.version).toBe(2);
  });

  it('enforces version on empty-update conflict checks', async () => {
    const s = await adapter.createSession(sessionData());
    await adapter.updateSession(s.id, { version: 2 }, { expectedVersion: 1 });
    await expect(adapter.updateSession(s.id, {}, { expectedVersion: 1 })).rejects.toThrow(
      ConcurrencyError
    );
  });

  it('applies unconditionally when no expectedVersion is given', async () => {
    const s = await adapter.createSession(sessionData());
    const updated = await adapter.updateSession(s.id, { status: 'completed' });
    expect(updated.status).toBe('completed');
  });
});
