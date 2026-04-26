# Skill: Implement Core Types

## Purpose

Create the TypeScript type definitions that form the public API contract of session-continuity-kit.

## When to Use

- Phase 1 of development
- When defining or revising the domain model
- Before any implementation work that depends on these types

## Prerequisites

- Project setup complete (`pnpm install` works)
- `packages/core/src/types/` directory exists

## Step-by-Step Instructions

### 1. Create `packages/core/src/types/session.ts`

Define:

- `SessionId`, `MessageId` as branded string aliases or simple `string` types
- `MessageRole = 'user' | 'assistant' | 'system' | 'tool'`
- `Participant` with `id`, `role`, `metadata`, `joinedAt`, `leftAt`
- `MessageContent` as a type alias: `string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>`
- `Message` with `id`, `sessionId`, `role`, `content: MessageContent`, `tokenCount?`, `metadata?`, `createdAt`, `updatedAt?`
- `MessageMetadata` with `toolCalls?`, `toolResults?`, `annotations?`
- `ToolCall`, `ToolResult`
- `Session<T = Record<string, unknown>>` with generic metadata support
- `SessionStatus = 'active' | 'paused' | 'completed' | 'expired'`
- `SessionMetadata` with `title?`, `tags?`, `source?`, `custom?: T`
- Add `schemaVersion?: number` to `Session` (default to `1`)

### 2. Create `packages/core/src/types/token.ts`

Define:

- `TokenBudgetConfig` with `maxTokens`, `reserveTokens`, `overflowStrategy: 'truncate' | 'compress' | 'error'`
  - Document that `'truncate'` means "drop oldest non-system messages until budget fits"
- `TokenCountResult`
- `TokenCounter` interface with `count(text)`, `countMessages(messages)`, `readonly model`, `readonly tokenizer`

### 3. Create `packages/core/src/types/compression.ts`

Define `CompressionConfig` as a **discriminated union**:

```typescript
export type CompressionConfig =
  | { strategy: 'sliding_window'; targetTokens: number; minMessages?: number; maxMessages?: number }
  | {
      strategy: 'summarization';
      targetTokens: number;
      summarizer: SummarizerService;
      summarizationPrompt?: string;
    }
  | {
      strategy: 'hybrid';
      targetTokens: number;
      maxMessages?: number;
      summarizer: SummarizerService;
      summarizationPrompt?: string;
    };
```

Also define:

- `CompressionStrategyType`
- `CompressionResult`
- `ICompressionStrategy` interface
- `SummarizerService` interface (summarize messages → string)

### 4. Create `packages/core/src/types/storage.ts`

Define:

- `IStorageAdapter` with all CRUD methods for sessions and messages
- `SessionFilters`, `MessageQueryOptions`
- `HealthStatus`

### 5. Create `packages/core/src/types/events.ts`

Define:

- `SessionEvent` union of all event names
- `SessionEventPayload`
- `EventHandler` type

### 6. Create `packages/core/src/types/config.ts`

Define missing configuration types:

- `SessionManagerConfig`
- `MessageWindowConfig`
- `CreateSessionOptions`
- `CreateMessageOptions`
- `CreateParticipantOptions`
- `HandoffContext`
- `BudgetStatus`
- `Logger` interface (minimal: `debug`, `info`, `warn`, `error` methods)

### 7. Create `packages/core/src/types/errors.ts`

Define error classes:

- `SessionError` (base)
- `SessionNotFoundError`
- `TokenBudgetExceededError`
- `StorageError`
- `CompressionError`
- `ValidationError`
- `HandoffError`

### 8. Export Everything

Create `packages/core/src/types/index.ts` that re-exports all types.

## Validation

- [ ] `pnpm type-check` passes with zero errors
- [ ] No `any` types in any exported interface
- [ ] All interfaces have JSDoc comments
- [ ] `CompressionConfig` is a discriminated union (hover in IDE shows correct narrowing)
- [ ] `MessageContent` is exported and used by `Message`
- [ ] `Session` has `schemaVersion` field

## Common Pitfalls

- **Do NOT** use `any` for metadata — use `unknown` or generics
- **Do NOT** forget to export `SummarizerService` — compression strategies depend on it
- **Do NOT** use a single flat `CompressionConfig` interface — the discriminated union prevents invalid config combinations
- **Do NOT** forget `readonly` on interface properties that should be immutable
