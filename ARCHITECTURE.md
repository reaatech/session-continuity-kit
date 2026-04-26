# Session Continuity Kit — Architecture Deep Dive

## System Overview

The session-continuity-kit is built on a layered architecture that separates concerns between session management, compression strategies, and storage backends. This design enables flexibility, testability, and extensibility while maintaining a clean, type-safe API.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Application Layer                            │
│                    (Your AI Agent Application)                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Public API Layer                             │
│                         SessionManager                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   Session    │  │    Message   │  │      Compression         │  │
│  │  Lifecycle   │  │   Window     │  │      Management          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Core Services Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │    Token     │  │    Event     │  │      Repository          │  │
│  │   Budget     │  │   Emitter    │  │      Pattern             │  │
│  │   Manager    │  │              │  │                          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Compression Strategy Layer                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   Sliding    │  │ Summarization│  │        Hybrid            │  │
│  │   Window     │  │   Strategy   │  │       Strategy           │  │
│  │   Strategy   │  │              │  │                          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Storage Adapter Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────┐ │
│  │   Firestore  │  │   DynamoDB   │  │    Redis     │  │ Memory  │ │
│  │   Adapter    │  │   Adapter    │  │   Adapter    │  │ Adapter │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Storage Backends                               │
│     Firebase       AWS DynamoDB        Redis        In-Memory       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Design Principles

### 1. **Separation of Concerns**

Each layer has a single responsibility:

- **Public API**: High-level session operations
- **Core Services**: Token management, events, repository coordination
- **Compression**: Context reduction strategies
- **Storage**: Data persistence and retrieval

### 2. **Dependency Inversion**

High-level modules don't depend on low-level modules. Both depend on abstractions:

- `IStorageAdapter` interface abstracts storage details
- `ICompressionStrategy` interface abstracts compression logic
- `TokenCounter` interface abstracts tokenization

### 3. **Strategy Pattern**

Compression strategies are pluggable and interchangeable:

- `SlidingWindowStrategy`: Simple, fast, deterministic
- `SummarizationStrategy`: Intelligent compression using LLMs
- `HybridStrategy`: Best of both worlds

### 4. **Repository Pattern**

The `SessionRepository` provides a collection-like interface for sessions:

- Decouples domain logic from storage
- Enables easy testing with in-memory implementations
- Provides consistent query interface

### 5. **Event-Driven Architecture**

Session lifecycle events enable reactive programming:

- `session:created`, `session:ended`, `session:expired`
- `message:added`, `message:deleted`
- `agent:handoff`, `compression:applied`
- `budget:exceeded`, `error`

---

## Core Components

### SessionManager

The facade that coordinates all session operations.

**Responsibilities:**

- Session lifecycle management (create, read, update, delete, end)
- Message management with automatic token tracking
- Compression orchestration
- Participant management
- Agent handoffs
- Cleanup of expired sessions

**Key Design Decisions:**

- **Stateless operations**: Each method call is independent; state is stored in the adapter
- **Atomic operations**: Multi-step operations are wrapped in transactions where possible
- **Lazy compression**: Compression happens on-demand unless `autoCompress` is enabled
- **Event emission**: All state changes emit events for observers

```typescript
export class SessionManager {
  constructor(private config: SessionManagerConfig) {
    this.repository = new SessionRepository(config.storage);
    this.eventEmitter = config.eventEmitter ?? new SessionEventEmitter();
    this.tokenCounter = config.tokenCounter;

    // Start cleanup job if configured
    if (config.cleanupInterval && config.cleanupInterval > 0) {
      this.startCleanupJob(config.cleanupInterval);
    }
  }

  async createSession(options?: CreateSessionOptions): Promise<Session> {
    const session: Session = {
      ...options,
      id: generateId(),
      status: 'active',
      metadata: options?.metadata ?? {},
      participants: [],
      schemaVersion: 1,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      expiresAt: this.config.sessionTTL
        ? new Date(Date.now() + this.config.sessionTTL * 1000)
        : undefined,
      tokenBudget: options?.tokenBudget ?? this.config.tokenBudget,
      compression: options?.compression ?? this.config.compression,
    };

    const created = await this.repository.createSession(session);
    this.emit('session:created', { sessionId: created.id });
    return created;
  }

  async getConversationContext(sessionId: SessionId): Promise<Message[]> {
    const session = await this.repository.getSession(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    let messages = await this.repository.getMessages(sessionId, {
      order: 'asc',
    });

    // Apply compression if configured
    if (session.compression && this.shouldCompress(messages, session.tokenBudget)) {
      const result = await this.compress(messages, session.compression);
      messages = result.compressedMessages;
      this.emit('compression:applied', { sessionId, strategy: result.strategy });
    }

    // Update last activity
    await this.repository.updateSession(sessionId, {
      lastActivityAt: new Date(),
    });

    return messages;
  }
}
```

### MessageWindow

Pure utility for calculating which messages fit within token constraints.

**Responsibilities:**

- Calculate which messages fit within token budget
- Provide token usage snapshots

**Key Design Decisions:**

- **Stateless**: No internal message storage; operates on input arrays
- **System messages are sacred**: System messages are always kept
- **FIFO eviction**: Oldest non-system messages are removed first
- **Token-accurate**: Uses actual token counts, not estimates
- **Configurable reserves**: Reserves tokens for system prompt and response

```typescript
export class MessageWindow {
  constructor(
    private config: MessageWindowConfig,
    private tokenCounter: TokenCounter
  ) {}

  getFittedMessages(messages: Message[]): Message[] {
    const { maxTokens, reserveTokens } = this.config.tokenBudget;
    const availableTokens = maxTokens - reserveTokens;

    // Always keep system messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    const systemTokens = this.tokenCounter.countMessages(systemMessages);

    // Get non-system messages in reverse chronological order
    const otherMessages = messages
      .filter((m) => m.role !== 'system')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const fitted: Message[] = [];
    let currentTokens = systemTokens;

    // Add messages from newest to oldest until budget is reached
    for (const message of otherMessages) {
      const tokenCount = message.tokenCount ?? this.tokenCounter.count(message.content);
      if (currentTokens + tokenCount <= availableTokens) {
        fitted.unshift(message); // Add to front to maintain order
        currentTokens += tokenCount;
      } else {
        break;
      }
    }

    return [...systemMessages, ...fitted];
  }
}
```

### TokenBudget

Manages token budget calculations and enforcement.

**Responsibilities:**

- Track current token usage
- Calculate available tokens
- Determine if budget is exceeded
- Provide budget status information

**Key Design Decisions:**

- **Pre-computed counts**: Token counts are stored on messages to avoid recalculation
- **Lazy counting**: Tokens are counted on first access if not pre-computed
- **Overflow strategies**: Configurable behavior when budget is exceeded

```typescript
export class TokenBudget {
  constructor(
    private config: TokenBudgetConfig,
    private tokenCounter: TokenCounter
  ) {}

  wouldExceedBudget(currentTokens: number, additionalTokens: number): boolean {
    const available = this.getAvailableTokens(currentTokens);
    return additionalTokens > available;
  }

  getAvailableTokens(usedTokens: number): number {
    const { maxTokens, reserveTokens } = this.config;
    return Math.max(0, maxTokens - reserveTokens - usedTokens);
  }

  getStatus(usedTokens: number): BudgetStatus {
    const available = this.getAvailableTokens(usedTokens);
    const percentage = (usedTokens / this.config.maxTokens) * 100;

    return {
      usedTokens,
      availableTokens: available,
      maxTokens: this.config.maxTokens,
      percentage,
      isOverBudget: available <= 0,
      severity: percentage > 90 ? 'critical' : percentage > 75 ? 'warning' : 'normal',
    };
  }
}
```

---

## Compression Strategies

### Strategy Interface

All compression strategies implement the same interface:

```typescript
export interface ICompressionStrategy {
  compress(
    messages: Message[],
    config: CompressionConfig,
    tokenCounter: TokenCounter
  ): Promise<CompressionResult>;

  readonly type: CompressionStrategyType;
}
```

### SlidingWindowStrategy

The simplest strategy: keep the most recent messages that fit within budget.

**Algorithm:**

1. Keep all system messages (always)
2. Sort non-system messages by creation date (newest first)
3. Add messages until token budget is reached
4. Return the fitted message set

**Pros:**

- Fast and deterministic
- No external dependencies
- Preserves exact conversation history

**Cons:**

- Loses older context completely
- No semantic understanding
- May lose important early context

**Best for:**

- Short conversations
- When exact history is critical
- When LLM calls for summarization are too expensive

```typescript
export class SlidingWindowStrategy implements ICompressionStrategy {
  readonly type = 'sliding_window';

  async compress(
    messages: Message[],
    config: CompressionConfig,
    tokenCounter: TokenCounter
  ): Promise<CompressionResult> {
    const originalTokenCount = tokenCounter.countMessages(messages);

    // Keep system messages
    const systemMessages = messages.filter((m) => m.role === 'system');

    // Slide window from newest to oldest
    const otherMessages = messages
      .filter((m) => m.role !== 'system')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const kept: Message[] = [];
    let tokenCount = tokenCounter.countMessages(systemMessages);
    const targetTokens = config.targetTokens;

    for (const message of otherMessages) {
      const count = message.tokenCount ?? tokenCounter.count(message.content);
      if (tokenCount + count <= targetTokens) {
        kept.unshift(message);
        tokenCount += count;
      } else {
        break;
      }
    }

    const compressedMessages = [...systemMessages, ...kept];
    const compressedIds = new Set(compressedMessages.map((m) => m.id));
    const removedMessages = messages.filter((m) => !compressedIds.has(m.id));

    return {
      originalMessages: messages,
      compressedMessages,
      originalTokenCount,
      compressedTokenCount: tokenCount,
      strategy: 'sliding_window',
      removedMessages,
    };
  }
}
```

### SummarizationStrategy

Uses an LLM to summarize older messages into a condensed summary.

**Algorithm:**

1. Identify messages to summarize (oldest ones exceeding target)
2. Call LLM with summarization prompt
3. Replace summarized messages with summary message
4. Keep recent messages intact

**Pros:**

- Preserves semantic information from entire conversation
- Can compress large amounts of text into small summaries
- Maintains conversation flow

**Cons:**

- Requires LLM calls (cost, latency)
- May lose specific details
- Summaries can hallucinate

**Best for:**

- Long-running conversations
- When semantic context is more important than exact details
- When token budget is very tight

```typescript
export class SummarizationStrategy implements ICompressionStrategy {
  readonly type = 'summarization';

  constructor(private summarizer: SummarizerService) {}

  async compress(
    messages: Message[],
    config: CompressionConfig,
    tokenCounter: TokenCounter
  ): Promise<CompressionResult> {
    const originalTokenCount = tokenCounter.countMessages(messages);

    // Determine which messages to summarize
    const { toSummarize, toKeep } = this.partitionMessages(messages, config, tokenCounter);

    // Generate summary if there are messages to summarize
    let summary: string | undefined;
    if (toSummarize.length > 0) {
      summary = await this.summarizer.summarize(toSummarize, config.summarizationPrompt);
    }

    // Create summary message if we have a summary
    const summaryMessage: Message | undefined = summary
      ? {
          id: generateId(),
          sessionId: messages[0]?.sessionId ?? '',
          role: 'system',
          content: `Previous conversation summary: ${summary}`,
          createdAt: new Date(),
          tokenCount: tokenCounter.count(summary),
        }
      : undefined;

    const compressedMessages = summaryMessage ? [summaryMessage, ...toKeep] : toKeep;

    const compressedTokenCount = tokenCounter.countMessages(compressedMessages);

    return {
      originalMessages: messages,
      compressedMessages,
      originalTokenCount,
      compressedTokenCount,
      strategy: 'summarization',
      summary,
      removedMessages: toSummarize,
    };
  }
}
```

### HybridStrategy

Combines sliding window for recent messages and summarization for older context.

**Algorithm:**

1. Keep last N messages as-is (configurable)
2. Summarize everything before that
3. Combine summary + recent messages

**Pros:**

- Best of both worlds: recent detail + historical context
- More predictable than pure summarization
- Reduces LLM calls compared to pure summarization

**Cons:**

- More complex implementation
- Still requires LLM calls
- May have redundancy between summary and recent messages

**Best for:**

- Most production use cases
- Long conversations with recent detail importance
- When you want both precision and context

```typescript
export class HybridStrategy implements ICompressionStrategy {
  readonly type = 'hybrid';

  constructor(private summarizer: SummarizerService) {}

  async compress(
    messages: Message[],
    config: CompressionConfig,
    tokenCounter: TokenCounter
  ): Promise<CompressionResult> {
    const originalTokenCount = tokenCounter.countMessages(messages);

    // Keep system messages always
    const systemMessages = messages.filter((m) => m.role === 'system');

    // Get recent messages to keep as-is
    const recentMessages = messages
      .filter((m) => m.role !== 'system')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, config.maxMessages ?? 20)
      .reverse(); // Restore chronological order

    // Messages to summarize
    const toSummarize = messages.filter((m) => m.role !== 'system' && !recentMessages.includes(m));

    // Generate summary
    let summary: string | undefined;
    if (toSummarize.length > 0) {
      summary = await this.summarizer.summarize(toSummarize, config.summarizationPrompt);
    }

    // Build compressed message set
    const summaryMessage: Message | undefined = summary
      ? {
          id: generateId(),
          sessionId: messages[0]?.sessionId ?? '',
          role: 'system',
          content: `Previous conversation summary: ${summary}`,
          createdAt: new Date(),
          tokenCount: tokenCounter.count(summary),
        }
      : undefined;

    const compressedMessages = [
      ...systemMessages,
      ...(summaryMessage ? [summaryMessage] : []),
      ...recentMessages,
    ];

    const compressedTokenCount = tokenCounter.countMessages(compressedMessages);

    return {
      originalMessages: messages,
      compressedMessages,
      originalTokenCount,
      compressedTokenCount,
      strategy: 'hybrid',
      summary,
      removedMessages: toSummarize,
    };
  }
}
```

---

## Storage Adapter Layer

### Adapter Interface

All storage adapters implement `IStorageAdapter`:

```typescript
export interface IStorageAdapter {
  // Session CRUD
  createSession(session: Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'>): Promise<Session>;
  getSession(id: SessionId): Promise<Session | null>;
  updateSession(id: SessionId, updates: Partial<Session>): Promise<Session>;
  deleteSession(id: SessionId): Promise<void>;
  listSessions(filters?: SessionFilters): Promise<Session[]>;

  // Message management
  addMessage(
    sessionId: SessionId,
    message: Omit<Message, 'id' | 'sessionId' | 'createdAt'>
  ): Promise<Message>;
  getMessages(sessionId: SessionId, options?: MessageQueryOptions): Promise<Message[]>;
  updateMessage(
    sessionId: SessionId,
    messageId: MessageId,
    updates: Partial<Message>
  ): Promise<Message>;
  deleteMessage(sessionId: SessionId, messageId: MessageId): Promise<void>;
  deleteAllMessages(sessionId: SessionId): Promise<void>;

  // Cleanup
  getExpiredSessions(before: Date): Promise<SessionId[]>;

  // Lifecycle
  health(): Promise<HealthStatus>;
  close(): Promise<void>;
}
```

### Adapter Design Patterns

#### 1. **Connection Management**

Each adapter manages its own connection lifecycle:

```typescript
export class RedisAdapter implements IStorageAdapter {
  private client: Redis;
  private isConnected = false;

  constructor(private config: RedisConfig) {
    this.client = this.createClient();
  }

  private createClient(): Redis {
    const client = createClient({
      url: this.config.url,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
      },
    });

    client.on('connect', () => {
      this.isConnected = true;
    });

    client.on('error', (err) => {
      this.isConnected = false;
      // Log error instead of throwing — event listeners cannot propagate errors
      console.error('Redis connection error:', err);
    });

    return client;
  }

  async health(): Promise<HealthStatus> {
    try {
      const start = Date.now();
      await this.client.ping();
      return {
        status: 'healthy',
        latency: Date.now() - start,
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        details: { error: err.message },
      };
    }
  }

  async close(): Promise<void> {
    if (this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
    }
  }
}
```

#### 2. **Serialization**

Each adapter handles serialization appropriate to its backend:

```typescript
// Firestore uses native types
const firestoreDoc = {
  id: session.id,
  userId: session.userId,
  status: session.status,
  metadata: session.metadata,
  participants: session.participants.map((p) => ({
    ...p,
    joinedAt: Timestamp.fromDate(p.joinedAt),
    leftAt: p.leftAt ? Timestamp.fromDate(p.leftAt) : null,
  })),
  createdAt: Timestamp.fromDate(session.createdAt),
  lastActivityAt: Timestamp.fromDate(session.lastActivityAt),
  expiresAt: session.expiresAt ? Timestamp.fromDate(session.expiresAt) : null,
  tokenBudget: session.tokenBudget,
  compression: session.compression,
};

// Redis uses JSON strings
const redisValue = JSON.stringify({
  ...session,
  participants: session.participants.map((p) => ({
    ...p,
    joinedAt: p.joinedAt.toISOString(),
    leftAt: p.leftAt?.toISOString(),
  })),
  createdAt: session.createdAt.toISOString(),
  lastActivityAt: session.lastActivityAt.toISOString(),
  expiresAt: session.expiresAt?.toISOString(),
});
```

#### 3. **Query Optimization**

Each adapter implements queries using native capabilities:

**Firestore:**

```typescript
async getMessages(
  sessionId: SessionId,
  options?: MessageQueryOptions
): Promise<Message[]> {
  let query = this.firestore
    .collection(`sessions/${sessionId}/messages`)
    .orderBy('createdAt', options?.order === 'desc' ? 'desc' : 'asc');

  if (options?.after) {
    query = query.where('createdAt', '>', Timestamp.fromDate(options.after));
  }

  if (options?.before) {
    query = query.where('createdAt', '<', Timestamp.fromDate(options.before));
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const snapshot = await query.get();
  return snapshot.docs.map(doc => this.deserializeMessage(doc.data()));
}
```

**DynamoDB:**

```typescript
async getMessages(
  sessionId: SessionId,
  options?: MessageQueryOptions
): Promise<Message[]> {
  const input: QueryCommandInput = {
    TableName: this.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':skPrefix': 'MSG#'
    },
    ScanIndexForward: options?.order !== 'desc'
  };

  if (options?.limit) {
    input.Limit = options.limit;
  }

  const result = await this.client.query(input);
  return result.Items?.map(item => this.deserializeMessage(item)) ?? [];
}
```

**Redis:**

```typescript
async getMessages(
  sessionId: SessionId,
  options?: MessageQueryOptions
): Promise<Message[]> {
  const key = `session:${sessionId}:messages`;
  const start = options?.offset ?? 0;
  const stop = options?.limit ? start + options.limit - 1 : -1;

  // Messages stored as sorted set with timestamp as score
  const messageIds = options?.order === 'desc'
    ? await this.client.zRevRange(key, start, stop)
    : await this.client.zRange(key, start, stop);

  // Fetch message data from hashes
  const messages = await Promise.all(
    messageIds.map(id => this.client.hGetAll(`message:${id}`))
  );

  return messages
    .filter(m => m.id)
    .map(m => this.deserializeMessage(m));
}
```

> **Redis `listSessions` Limitation:** Redis does not natively support filtered queries across sessions. `listSessions` with filters (`userId`, `status`, `tags`, date ranges) must use `SCAN` with client-side filtering, which is **O(N)** across all sessions. For production use cases requiring frequent session listing, use Firestore or DynamoDB, or maintain secondary indexes (e.g., `user:{userId}:sessions` as a Set) explicitly.

#### 4. **TTL Handling**

Each adapter implements TTL using native capabilities where available:

**Firestore (TTL Policy):**

```typescript
async createSession(session: Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'>): Promise<Session> {
  const docRef = this.firestore.collection('sessions').doc();
  const expiresAt = this.config.ttlSeconds
    ? new Date(Date.now() + this.config.ttlSeconds * 1000)
    : undefined;

  const data = {
    ...this.serializeSession(session),
    expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null,
    __ttl: expiresAt // Field used by TTL policy
  };

  await docRef.set(data);
  return { ...session, id: docRef.id, expiresAt, createdAt: new Date(), lastActivityAt: new Date() };
}
```

**DynamoDB (TTL Attribute):**

```typescript
async createSession(session: Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'>): Promise<Session> {
  const expiresAt = this.config.ttlSeconds
    ? Math.floor((Date.now() + this.config.ttlSeconds * 1000) / 1000)
    : undefined;

  const item = {
    PK: `SESSION#${generateId()}`,
    SK: 'META',
    ...this.serializeSession(session),
    expiresAt, // DynamoDB TTL attribute
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString()
  };

  await this.client.put({
    TableName: this.tableName,
    Item: item
  });

  return this.deserializeSession(item);
}
```

**Redis (EXPIRE):**

```typescript
async createSession(session: Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'>): Promise<Session> {
  const id = generateId();
  const sessionKey = `session:${id}`;

  const data = {
    ...this.serializeSession(session),
    id,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString()
  };

  await this.client.hSet(sessionKey, data);

  if (this.config.ttlSeconds) {
    await this.client.expire(sessionKey, this.config.ttlSeconds);
  }

  return this.deserializeSession(data);
}
```

---

## Token Counting

### TokenCounter Interface

```typescript
export interface TokenCounter {
  count(text: string): number;
  countMessages(messages: Message[]): number;
  readonly model: string;
  readonly tokenizer: string;
}
```

### Implementation Strategy

**TiktokenTokenizer (OpenAI):**

```typescript
export class TiktokenTokenizer implements TokenCounter {
  private encoding: Encoding;

  constructor(model: string = 'gpt-4') {
    this.encoding = encodingForModel(model);
  }

  count(text: string): number {
    return this.encoding.encode(text).length;
  }

  countMessages(messages: Message[]): number {
    let total = 0;

    // Each message has overhead (role, etc.)
    for (const message of messages) {
      total += 3; // Role overhead
      total += this.count(message.content);

      if (message.metadata?.toolCalls) {
        for (const toolCall of message.metadata.toolCalls) {
          total += this.count(toolCall.name);
          total += this.count(toolCall.arguments);
        }
      }
    }

    return total + 3; // Message list overhead
  }

  get model(): string {
    return this.encoding.name;
  }

  get tokenizer(): string {
    return 'tiktoken';
  }
}
```

**EstimateTokenizer (Fast fallback):**

```typescript
export class EstimateTokenizer implements TokenCounter {
  private readonly charsPerToken: number;

  constructor(charsPerToken: number = 4) {
    this.charsPerToken = charsPerToken;
  }

  count(text: string): number {
    return Math.ceil(text.length / this.charsPerToken);
  }

  countMessages(messages: Message[]): number {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(totalChars / this.charsPerToken) + messages.length * 3;
  }

  get model(): string {
    return 'estimate';
  }

  get tokenizer(): string {
    return 'estimate';
  }
}
```

---

## Event System

### Event Architecture

Events flow through an event emitter that can be customized:

```typescript
export class SessionEventEmitter {
  private handlers: Map<SessionEvent, Set<EventHandler>> = new Map();

  on(event: SessionEvent, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: SessionEvent, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: SessionEvent, payload: Omit<SessionEventPayload, 'type' | 'timestamp'>): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    const eventPayload: SessionEventPayload = {
      type: event,
      timestamp: new Date(),
      ...payload,
    };

    for (const handler of handlers) {
      try {
        handler(eventPayload);
      } catch (error) {
        console.error(`Event handler error for ${event}:`, error);
      }
    }
  }
}
```

### Event Types

| Event                 | Payload                                                     | When Emitted                     |
| --------------------- | ----------------------------------------------------------- | -------------------------------- |
| `session:created`     | `{ sessionId }`                                             | After session is created         |
| `session:updated`     | `{ sessionId, updates }`                                    | After session is updated         |
| `session:ended`       | `{ sessionId }`                                             | When session is explicitly ended |
| `session:expired`     | `{ sessionId }`                                             | When session expires (cleanup)   |
| `session:deleted`     | `{ sessionId }`                                             | After session is deleted         |
| `message:added`       | `{ sessionId, messageId }`                                  | After message is added           |
| `message:updated`     | `{ sessionId, messageId }`                                  | After message is updated         |
| `message:deleted`     | `{ sessionId, messageId }`                                  | After message is deleted         |
| `participant:joined`  | `{ sessionId, participantId }`                              | After participant joins          |
| `participant:left`    | `{ sessionId, participantId }`                              | After participant leaves         |
| `agent:handoff`       | `{ sessionId, fromAgent, toAgent }`                         | After agent handoff              |
| `compression:applied` | `{ sessionId, strategy, originalTokens, compressedTokens }` | After compression                |
| `budget:exceeded`     | `{ sessionId, used, limit }`                                | When budget is exceeded          |
| `error`               | `{ sessionId?, error }`                                     | On any error                     |

---

## Data Flow

### Creating a Session and Adding Messages

```
1. Application calls sessionManager.createSession()
2. SessionManager generates session ID and timestamps
3. SessionManager calls repository.createSession()
4. Repository serializes and stores via adapter
5. Adapter persists to storage backend
6. SessionManager emits 'session:created' event
7. Session returned to application

---

1. Application calls sessionManager.addMessage(sessionId, { role, content })
2. SessionManager validates session exists
3. SessionManager generates message ID and timestamp
4. SessionManager counts tokens (if not pre-computed)
5. SessionManager checks token budget
6. If over budget and autoCompress enabled:
   a. SessionManager gets compression strategy
   b. Strategy compresses messages
   c. Compressed messages replace originals
7. SessionManager calls repository.addMessage()
8. Repository serializes and stores via adapter
9. Adapter persists to storage backend
10. SessionManager updates session.lastActivityAt
11. SessionManager emits 'message:added' event
12. Message returned to application
```

### Getting Conversation Context (with Compression)

```
1. Application calls sessionManager.getConversationContext(sessionId)
2. SessionManager validates session exists
3. SessionManager fetches all messages for session
4. SessionManager checks if compression is configured
5. If compression configured:
   a. SessionManager checks if compression is needed (token count vs target)
   b. If needed, SessionManager gets compression strategy
   c. Strategy processes messages:
      - SlidingWindow: keeps recent messages
      - Summarization: calls LLM to summarize old messages
      - Hybrid: keeps recent + summarizes old
   d. Strategy returns CompressionResult
   e. SessionManager emits 'compression:applied' event
6. SessionManager updates session.lastActivityAt
7. Compressed (or original) messages returned to application
```

---

## Error Handling

### Error Hierarchy

```
Error
├── SessionError (base for all session errors)
│   ├── SessionNotFoundError
│   ├── TokenBudgetExceededError
│   ├── StorageError
│   │   ├── FirestoreError
│   │   ├── DynamoDBError
│   │   └── RedisError
│   ├── CompressionError
│   ├── ValidationError
│   └── HandoffError
```

### Error Recovery Strategies

1. **Transient storage errors**: Retry with exponential backoff
2. **Token budget exceeded**: Auto-compress if configured, else throw
3. **Compression failure**: Fall back to sliding window
4. **Session not found**: Create new session (if allowed by config)

---

## Concurrency & Optimistic Locking

### Problem

In production, multiple agents or handlers may access the same session concurrently:

- **Handoff race**: Agent A and Agent B both try to update `activeAgentId`
- **Message race**: Two messages added simultaneously may cause budget miscalculations
- **Update clobbering**: `updateSession` overwrites fields without checking current state

### Strategy

1. **Add `version` to `Session`:**

   ```typescript
   export interface Session {
     // ...existing fields
     version: number;
   }
   ```

2. **Adapter-level conditional writes:**

   - **Firestore**: Use `update()` with `lastUpdateTime` precondition
   - **DynamoDB**: Use `ConditionExpression: 'version = :expected'` in `UpdateItem`
   - **Redis**: Use `WATCH` + `MULTI/EXEC` transactions
   - **MemoryAdapter**: Use simple compare-and-swap

3. **SessionManager retry logic:**
   - On `version mismatch`, re-read session and retry operation
   - Exponential backoff with jitter
   - Max 3 retries before throwing `ConcurrencyError`

### When to Implement

- **Phase 4 (Advanced Features)**: Add `version` field and conditional writes
- **Phase 1**: Design `Session` with `version?: number` placeholder so adapters can opt in

---

## Performance Considerations

### Optimizations

1. **Pre-computed token counts**: Store token counts on messages to avoid recalculation
2. **Batch operations**: Use batch writes for multiple messages
3. **Caching**: Cache frequently accessed sessions in memory
4. **Lazy loading**: Load messages on-demand, not with session
5. **Pagination**: Support pagination for large message histories
6. **Indexes**: Ensure proper indexes on storage backends
7. **Connection pooling**: Reuse connections across operations

### Bottlenecks

1. **Token counting**: Can be slow for large texts (use estimates for speed)
2. **Compression**: LLM calls add latency (use async, cache summaries)
3. **Storage queries**: Unoptimized queries can be slow (ensure proper indexes)
4. **Serialization**: Large messages can be slow to serialize (stream if possible)

---

## Security Considerations

1. **Input validation**: Validate all inputs before processing
2. **Injection prevention**: Use parameterized queries (DynamoDB, Firestore)
3. **Access control**: Implement proper authentication/authorization at adapter level
4. **Data encryption**: Encrypt sensitive session data at rest
5. **Rate limiting**: Implement rate limits per session/user
6. **Audit logging**: Log all session operations for compliance
7. **TTL enforcement**: Ensure expired sessions are actually deleted

---

## Extensibility Points

### Custom Compression Strategy

```typescript
export class CustomCompressionStrategy implements ICompressionStrategy {
  readonly type = 'custom';

  async compress(
    messages: Message[],
    config: CompressionConfig,
    tokenCounter: TokenCounter
  ): Promise<CompressionResult> {
    // Your custom compression logic
    return {
      originalMessages: messages,
      compressedMessages: messages,
      originalTokenCount: 0,
      compressedTokenCount: 0,
      strategy: 'custom',
      removedMessages: [],
    };
  }
}
```

### Custom Storage Adapter

```typescript
export class CustomStorageAdapter implements IStorageAdapter {
  async createSession(
    session: Omit<Session, 'id' | 'createdAt' | 'lastActivityAt'>
  ): Promise<Session> {
    // Your storage logic
  }

  // ... implement all IStorageAdapter methods
}
```

### Custom Token Counter

```typescript
export class CustomTokenizer implements TokenCounter {
  count(text: string): number {
    // Your token counting logic
  }

  countMessages(messages: Message[]): number {
    // Your message token counting logic
  }

  get model(): string {
    return 'custom';
  }
  get tokenizer(): string {
    return 'custom';
  }
}
```

---

## Deployment Considerations

### Scalability

- **Horizontal scaling**: Stateless SessionManager can scale horizontally
- **Database scaling**: Choose storage backend based on scale needs
- **Caching layer**: Add Redis cache in front of primary storage
- **CDN**: Cache static compression summaries

### High Availability

- **Multi-region**: Deploy storage in multiple regions
- **Failover**: Implement adapter failover logic
- **Circuit breaker**: Prevent cascade failures
- **Health checks**: Monitor adapter health

### Monitoring

- **Metrics**: Track session count, message rate, compression ratio
- **Logs**: Structured logging for all operations
- **Tracing**: Distributed tracing for debugging
- **Alerts**: Alert on errors, budget issues, storage problems
