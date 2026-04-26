import crypto from 'node:crypto';
import type {
  Session,
  SessionId,
  Message,
  MessageId,
  IStorageAdapter,
  SessionFilters,
  MessageQueryOptions,
  HealthStatus,
} from '@session-continuity-kit/core';
import { StorageError } from '@session-continuity-kit/core';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

/**
 * Configuration for the DynamoDB storage adapter.
 */
export interface DynamoDBAdapterConfig {
  client: DynamoDBDocumentClient;
  tableName: string;
}

/**
 * DynamoDB storage adapter using a single-table design with GSIs
 * for user and agent lookups.
 *
 * @example
 * ```typescript
 * import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
 * const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
 * const adapter = new DynamoDBAdapter({ client, tableName: 'sessions' });
 * ```
 */
export class DynamoDBAdapter implements IStorageAdapter {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor(config: DynamoDBAdapterConfig) {
    this.client = config.client;
    this.tableName = config.tableName;
  }

  /**
   * Create a new session.
   *
   * @param session - Session data
   * @returns The created session
   */
  async createSession(
    session: Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'>
  ): Promise<Session> {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const expiresAt = session.expiresAt
        ? Math.floor(session.expiresAt.getTime() / 1000)
        : undefined;

      const item = {
        PK: `SESSION#${id}`,
        SK: 'META',
        GSI1PK: session.userId ? `USER#${session.userId}` : undefined,
        GSI1SK: `CREATED_AT#${now}`,
        GSI2PK: session.activeAgentId ? `AGENT#${session.activeAgentId}` : undefined,
        GSI2SK: `STATUS#${session.status}`,
        ...this.serializeSession(session),
        id,
        createdAt: now,
        lastActivityAt: now,
        expiresAt,
        ttl: expiresAt,
      };

      const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        })
      );

      return this.deserializeSession(item);
    } catch (err) {
      throw new StorageError('Failed to create session', 'dynamodb', err as Error);
    }
  }

  /**
   * Get a session by ID.
   *
   * @param id - Session identifier
   * @returns The session or null if not found
   */
  async getSession(id: SessionId): Promise<Session | null> {
    try {
      const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
      const result = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            PK: `SESSION#${id}`,
            SK: 'META',
          },
        })
      );

      if (!result.Item) return null;
      return this.deserializeSession(result.Item);
    } catch (err) {
      throw new StorageError('Failed to get session', 'dynamodb', err as Error);
    }
  }

  /**
   * Update a session.
   *
   * @param id - Session identifier
   * @param updates - Partial session updates
   * @returns The updated session
   */
  async updateSession(id: SessionId, updates: Partial<Session>): Promise<Session> {
    try {
      const expressionParts: string[] = [];
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};

      let idx = 0;
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) continue;
        const nameKey = `#f${idx}`;
        const valueKey = `:v${idx}`;
        expressionParts.push(`${nameKey} = ${valueKey}`);
        names[nameKey] = key;
        values[valueKey] = this.serializeValue(key, value);
        idx++;
      }

      if (updates.userId !== undefined) {
        expressionParts.push('#gsi1pk = :gsi1pk');
        names['#gsi1pk'] = 'GSI1PK';
        values[':gsi1pk'] = updates.userId ? `USER#${updates.userId}` : undefined;
      }
      if (updates.status !== undefined) {
        expressionParts.push('#gsi2sk = :gsi2sk');
        names['#gsi2sk'] = 'GSI2SK';
        values[':gsi2sk'] = `STATUS#${updates.status}`;
      }
      if (updates.activeAgentId !== undefined) {
        expressionParts.push('#gsi2pk = :gsi2pk');
        names['#gsi2pk'] = 'GSI2PK';
        values[':gsi2pk'] = updates.activeAgentId ? `AGENT#${updates.activeAgentId}` : undefined;
      }
      if (updates.expiresAt !== undefined) {
        const ttl = Math.floor(updates.expiresAt.getTime() / 1000);
        expressionParts.push('#ttl = :ttl');
        names['#ttl'] = 'ttl';
        values[':ttl'] = ttl;
      }

      if (expressionParts.length === 0) {
        const existing = await this.getSession(id);
        if (!existing) {
          throw new StorageError(`Session not found: ${id}`, 'dynamodb');
        }
        return existing;
      }

      const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            PK: `SESSION#${id}`,
            SK: 'META',
          },
          UpdateExpression: `SET ${expressionParts.join(', ')}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        })
      );

      const updated = await this.getSession(id);
      if (!updated) {
        throw new StorageError('Session disappeared after update', 'dynamodb');
      }
      return updated;
    } catch (err) {
      throw new StorageError('Failed to update session', 'dynamodb', err as Error);
    }
  }

  /**
   * Delete a session and all its messages.
   *
   * @param id - Session identifier
   */
  async deleteSession(id: SessionId): Promise<void> {
    try {
      const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');

      await this.deleteAllMessages(id);

      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            PK: `SESSION#${id}`,
            SK: 'META',
          },
        })
      );
    } catch (err) {
      throw new StorageError('Failed to delete session', 'dynamodb', err as Error);
    }
  }

  /**
   * List sessions with optional filters.
   *
   * @remarks Tag filtering uses OR semantics (matches if any tag is present).
   * @param filters - Query filters
   * @returns Array of matching sessions
   */
  async listSessions(filters?: SessionFilters): Promise<Session[]> {
    try {
      // Use the most selective GSI based on filters
      if (filters?.userId) {
        const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'GSI1',
            KeyConditionExpression: 'GSI1PK = :pk',
            ExpressionAttributeValues: {
              ':pk': `USER#${filters.userId}`,
            },
            ScanIndexForward: false,
            Limit: filters.limit,
          })
        );
        let sessions = (result.Items ?? [])
          .map((item) => this.deserializeSession(item))
          .filter((s) => this.matchesFilters(s, filters));
        if (filters?.offset) {
          sessions = sessions.slice(filters.offset);
        }
        return sessions;
      }

      if (filters?.activeAgentId) {
        const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'GSI2',
            KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
            ExpressionAttributeValues: {
              ':pk': `AGENT#${filters.activeAgentId}`,
              ':sk': filters.status ? `STATUS#${filters.status}` : 'STATUS#',
            },
            ScanIndexForward: false,
            Limit: filters.limit,
          })
        );
        let sessions = (result.Items ?? [])
          .map((item) => this.deserializeSession(item))
          .filter((s) => this.matchesFilters(s, filters));
        if (filters?.offset) {
          sessions = sessions.slice(filters.offset);
        }
        return sessions;
      }

      // Fallback to scan (not recommended for production with large datasets)
      const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'SK = :sk',
          ExpressionAttributeValues: {
            ':sk': 'META',
          },
          Limit: filters?.limit,
        })
      );

      let sessions = (result.Items ?? [])
        .map((item) => this.deserializeSession(item))
        .filter((s) => this.matchesFilters(s, filters));

      if (filters?.offset) {
        sessions = sessions.slice(filters.offset);
      }

      return sessions;
    } catch (err) {
      throw new StorageError('Failed to list sessions', 'dynamodb', err as Error);
    }
  }

  /**
   * Add a message to a session.
   *
   * @param sessionId - Session identifier
   * @param message - Message data
   * @returns The created message
   */
  async addMessage(
    sessionId: SessionId,
    message: Omit<Message, 'id' | 'sessionId' | 'createdAt'>
  ): Promise<Message> {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const item = {
        PK: `SESSION#${sessionId}`,
        SK: `MSG#${now}#${id}`,
        ...this.serializeMessage(message as Message),
        id,
        sessionId,
        createdAt: now,
      };

      const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
        })
      );

      return this.deserializeMessage(item);
    } catch (err) {
      throw new StorageError('Failed to add message', 'dynamodb', err as Error);
    }
  }

  /**
   * Get messages for a session.
   *
   * @remarks
   * The `after`, `before`, and `offset` query options are not supported by this adapter.
   * Results are paginated across the 1MB DynamoDB response limit via `LastEvaluatedKey`.
   * @param sessionId - Session identifier
   * @param options - Query options
   * @returns Array of messages
   */
  async getMessages(sessionId: SessionId, options?: MessageQueryOptions): Promise<Message[]> {
    try {
      const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
      const messages: Message[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;

      do {
        const input: QueryCommandInput = {
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': `SESSION#${sessionId}`,
            ':skPrefix': 'MSG#',
          },
          ScanIndexForward: options?.order !== 'desc',
          ExclusiveStartKey: exclusiveStartKey,
        };

        if (options?.limit) {
          input.Limit = options.limit - messages.length;
        }

        const result = await this.client.send(new QueryCommand(input));
        for (const item of result.Items ?? []) {
          messages.push(this.deserializeMessage(item));
        }

        exclusiveStartKey = result.LastEvaluatedKey;
        if (options?.limit && messages.length >= options.limit) break;
      } while (exclusiveStartKey);

      if (options?.roles && options.roles.length > 0) {
        const roles = options.roles;
        return messages.filter((m) => roles.includes(m.role));
      }

      return messages;
    } catch (err) {
      throw new StorageError('Failed to get messages', 'dynamodb', err as Error);
    }
  }

  /**
   * Update a message.
   *
   * @remarks
   * The SK embeds `createdAt`, so this method has to list the session's messages
   * to find the matching SK. O(N) in the session's message count — fine for most
   * conversational sessions but prefer addMessage over update-in-place for long-lived ones.
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier
   * @param updates - Partial message updates
   * @returns The updated message
   * @throws {StorageError} If message does not exist
   */
  async updateMessage(
    sessionId: SessionId,
    messageId: MessageId,
    updates: Partial<Message>
  ): Promise<Message> {
    try {
      // Find the message first (we need its SK)
      const messages = await this.getMessages(sessionId);
      const message = messages.find((m) => m.id === messageId);
      if (!message) {
        throw new StorageError(`Message not found: ${messageId}`, 'dynamodb');
      }

      const expressionParts: string[] = [];
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};

      let idx = 0;
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) continue;
        const nameKey = `#f${idx}`;
        const valueKey = `:v${idx}`;
        expressionParts.push(`${nameKey} = ${valueKey}`);
        names[nameKey] = key;
        values[valueKey] = this.serializeValue(key, value);
        idx++;
      }

      if (expressionParts.length === 0) {
        return message;
      }

      const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            PK: `SESSION#${sessionId}`,
            SK: `MSG#${message.createdAt.toISOString()}#${messageId}`,
          },
          UpdateExpression: `SET ${expressionParts.join(', ')}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        })
      );

      const updatedMessages = await this.getMessages(sessionId);
      const updated = updatedMessages.find((m) => m.id === messageId);
      if (!updated) {
        throw new StorageError('Message disappeared after update', 'dynamodb');
      }
      return updated;
    } catch (err) {
      throw new StorageError('Failed to update message', 'dynamodb', err as Error);
    }
  }

  /**
   * Delete a message.
   *
   * @remarks Like {@link updateMessage}, this is O(N) in the session's message count
   * because the SK includes `createdAt`.
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier
   */
  async deleteMessage(sessionId: SessionId, messageId: MessageId): Promise<void> {
    try {
      const messages = await this.getMessages(sessionId);
      const message = messages.find((m) => m.id === messageId);
      if (!message) return;

      const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            PK: `SESSION#${sessionId}`,
            SK: `MSG#${message.createdAt.toISOString()}#${messageId}`,
          },
        })
      );
    } catch (err) {
      throw new StorageError('Failed to delete message', 'dynamodb', err as Error);
    }
  }

  /**
   * Delete all messages for a session.
   *
   * @param sessionId - Session identifier
   */
  async deleteAllMessages(sessionId: SessionId): Promise<void> {
    try {
      const messages = await this.getMessages(sessionId);
      if (messages.length === 0) return;

      const { BatchWriteCommand } = await import('@aws-sdk/lib-dynamodb');
      // DynamoDB limits BatchWriteItem to 25 items per call.
      const BATCH_SIZE = 25;
      for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        const chunk = messages.slice(i, i + BATCH_SIZE);
        const requestItems = {
          [this.tableName]: chunk.map((m) => ({
            DeleteRequest: {
              Key: {
                PK: `SESSION#${sessionId}`,
                SK: `MSG#${m.createdAt.toISOString()}#${m.id}`,
              },
            },
          })),
        };
        await this.client.send(new BatchWriteCommand({ RequestItems: requestItems }));
      }
    } catch (err) {
      throw new StorageError('Failed to delete all messages', 'dynamodb', err as Error);
    }
  }

  /**
   * Get expired session IDs.
   *
   * @param before - Cutoff date
   * @returns Array of expired session IDs
   */
  async getExpiredSessions(before: Date): Promise<SessionId[]> {
    try {
      const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'SK = :sk AND ttl < :ttl',
          ExpressionAttributeValues: {
            ':sk': 'META',
            ':ttl': Math.floor(before.getTime() / 1000),
          },
        })
      );

      return (result.Items ?? []).map((item) => item.id as string);
    } catch (err) {
      throw new StorageError('Failed to get expired sessions', 'dynamodb', err as Error);
    }
  }

  /**
   * Health check.
   *
   * @returns Health status
   */
  async health(): Promise<HealthStatus> {
    try {
      const start = Date.now();
      const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
      await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: 'HEALTH#CHECK', SK: 'CHECK' },
        })
      );
      return {
        status: 'healthy',
        latency: Date.now() - start,
      };
    } catch (err) {
      // A ResourceNotFoundException or ConditionalCheckFailed is fine for health checks
      // We just want to verify connectivity
      if ((err as Error).name === 'ResourceNotFoundException') {
        return {
          status: 'healthy',
          latency: 0,
        };
      }
      return {
        status: 'unhealthy',
        details: { error: (err as Error).message },
      };
    }
  }

  /**
   * Close the adapter. DynamoDB client is stateless in v3.
   */
  async close(): Promise<void> {
    // DynamoDB client is stateless in v3
  }

  private serializeSession(
    session: Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'>
  ): Record<string, unknown> {
    const { participants, metadata, ...rest } = session as Record<string, unknown>;
    return {
      ...rest,
      participants: JSON.stringify(participants),
      metadata: JSON.stringify(metadata),
    };
  }

  private deserializeSession(item: Record<string, unknown>): Session {
    const data = { ...item };
    if (typeof data.participants === 'string') {
      data.participants = JSON.parse(data.participants);
    }
    if (typeof data.metadata === 'string') {
      data.metadata = JSON.parse(data.metadata);
    }
    data.createdAt = new Date(data.createdAt as string);
    data.lastActivityAt = new Date(data.lastActivityAt as string);
    data.expiresAt = data.expiresAt ? new Date((data.expiresAt as number) * 1000) : undefined;
    return data as unknown as Session;
  }

  private serializeMessage(message: Message): Record<string, unknown> {
    const { metadata, ...rest } = message as unknown as Record<string, unknown>;
    return {
      ...rest,
      metadata: JSON.stringify(metadata),
    };
  }

  private deserializeMessage(item: Record<string, unknown>): Message {
    const data = { ...item };
    if (typeof data.metadata === 'string') {
      data.metadata = JSON.parse(data.metadata);
    }
    data.createdAt = new Date(data.createdAt as string);
    return data as unknown as Message;
  }

  private serializeValue(key: string, value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (key === 'participants' || key === 'metadata') return JSON.stringify(value);
    return value;
  }

  private matchesFilters(session: Session, filters?: SessionFilters): boolean {
    if (!filters) return true;
    if (filters.status && session.status !== filters.status) return false;
    if (filters.userId && session.userId !== filters.userId) return false;
    if (filters.activeAgentId && session.activeAgentId !== filters.activeAgentId) return false;
    if (filters.createdAfter && session.createdAt < filters.createdAfter) return false;
    if (filters.createdBefore && session.createdAt > filters.createdBefore) return false;
    if (filters.tags && filters.tags.length > 0) {
      if (!filters.tags.some((tag) => session.metadata?.tags?.includes(tag))) return false;
    }
    return true;
  }
}
