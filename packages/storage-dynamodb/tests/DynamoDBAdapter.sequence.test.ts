import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DynamoDBAdapter } from '../src/DynamoDBAdapter.js';
import type { Session } from '@reaatech/session-continuity';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Mock DynamoDB client that sorts query results by sort key (SK) honoring
 * ScanIndexForward — the way real DynamoDB returns range-queried items — so the
 * `MSG#<createdAt>#<id>` ordering can be verified.
 */
function createSortingClient() {
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

        if (name === 'QueryCommand') {
          const pk = (input.ExpressionAttributeValues as Record<string, unknown>)?.[':pk'];
          const skPrefix = (input.ExpressionAttributeValues as Record<string, unknown>)?.[
            ':skPrefix'
          ] as string | undefined;
          let results = items.filter((i) => i.PK === pk);
          if (skPrefix) {
            results = results.filter((i) => (i.SK as string).startsWith(skPrefix));
          }
          // Real DynamoDB returns range items ordered by SK; reverse for ScanIndexForward=false.
          results = results.sort((a, b) =>
            (a.SK as string) < (b.SK as string) ? -1 : (a.SK as string) > (b.SK as string) ? 1 : 0
          );
          if (input.ScanIndexForward === false) results.reverse();
          return { Items: results };
        }

        return {};
      }
    ),
  };
}

function sessionData(): Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'> {
  return { status: 'active', metadata: {}, participants: [], schemaVersion: 1, version: 1 };
}

describe('DynamoDBAdapter — deterministic ordering (#6)', () => {
  let adapter: DynamoDBAdapter;

  beforeEach(() => {
    adapter = new DynamoDBAdapter({
      client: createSortingClient() as unknown as DynamoDBDocumentClient,
      tableName: 'test-table',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns messages in insertion order', async () => {
    const s = await adapter.createSession(sessionData());
    await adapter.addMessage(s.id, { role: 'user', content: 'one' });
    await adapter.addMessage(s.id, { role: 'assistant', content: 'two' });
    await adapter.addMessage(s.id, { role: 'user', content: 'three' });

    const ordered = await adapter.getMessages(s.id);
    expect(ordered.map((m) => m.content)).toEqual(['one', 'two', 'three']);
  });

  it('keeps insertion order when timestamps collide', async () => {
    // Freeze time so all three messages share the same createdAt millisecond.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const s = await adapter.createSession(sessionData());
    await adapter.addMessage(s.id, { role: 'user', content: 'first' });
    await adapter.addMessage(s.id, { role: 'assistant', content: 'second' });
    await adapter.addMessage(s.id, { role: 'user', content: 'third' });

    const ordered = await adapter.getMessages(s.id);
    expect(ordered.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });

  it('reverses correctly for descending order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const s = await adapter.createSession(sessionData());
    await adapter.addMessage(s.id, { role: 'user', content: 'first' });
    await adapter.addMessage(s.id, { role: 'assistant', content: 'second' });

    const ordered = await adapter.getMessages(s.id, { order: 'desc' });
    expect(ordered.map((m) => m.content)).toEqual(['second', 'first']);
  });
});
