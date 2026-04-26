# Skill: Implement Session Manager

## Purpose

Build the `SessionManager` facade and its supporting services (`MessageWindow`, `TokenBudget`, `SessionRepository`).

## When to Use

- Phase 1 core implementation
- After core types are defined

## Prerequisites

- Core types implemented and compiling
- `packages/core/src/session/`, `packages/core/src/repository/`, `packages/core/src/events/` exist

## Step-by-Step Instructions

### 1. Implement `SessionRepository`

File: `packages/core/src/repository/SessionRepository.ts`

- Wraps `IStorageAdapter`
- Provides `createSession`, `getSession`, `updateSession`, `deleteSession`, `listSessions`
- Provides `addMessage`, `getMessages`, `updateMessage`, `deleteMessage`, `deleteAllMessages`
- All methods should validate inputs and throw `ValidationError` for invalid data
- `updateSession` should merge updates shallowly (or as appropriate)

### 2. Implement `MessageWindow`

File: `packages/core/src/session/MessageWindow.ts`

- Constructor takes `MessageWindowConfig`
- `getFittedMessages(messages: Message[]): Message[]` — pure function, returns messages that fit budget
- `getTokenUsage(messages: Message[]): TokenCountResult` — pure function
- **Remove** `addMessage(messages[], newMessage)` method — this class should be stateless. Message addition and overflow detection belong in `SessionManager` or as a pure utility function.
- Always preserve system messages
- Evict oldest non-system messages first when over budget

### 3. Implement `TokenBudget`

File: `packages/core/src/session/TokenBudget.ts`

- Constructor takes `TokenBudgetConfig` and `TokenCounter`
- `wouldExceedBudget(currentTokens, additionalTokens): boolean`
- `getAvailableTokens(usedTokens): number`
- `getStatus(usedTokens): BudgetStatus`

### 4. Implement `SessionEventEmitter`

File: `packages/core/src/events/SessionEventEmitter.ts`

- Replace any references to `EventEmitter` with `SessionEventEmitter`
- Same API as described in ARCHITECTURE.md but with the new name
- Handle errors in event handlers gracefully (log and continue)

### 5. Implement `SessionManager`

File: `packages/core/src/session/SessionManager.ts`

- Constructor: `SessionManagerConfig`
- Initialize repository, event emitter, token counter
- Start cleanup job if `cleanupInterval > 0`
- **Fix spread order in `createSession`**: apply `...options` FIRST, then computed fields (`id`, `status`, `createdAt`, etc.)
- `createSession`: generate ID with `crypto.randomUUID()`, set `schemaVersion: 1`
- `getConversationContext`: fetch messages, check token budget, apply compression if needed, update `lastActivityAt`
- `addMessage`: validate session exists, count tokens, check budget, store message, update `lastActivityAt`, emit `message:added`
- `handoffToAgent`: update `activeAgentId`, emit `agent:handoff`
- `cleanupExpiredSessions`: delegate to adapter's `getExpiredSessions` + `deleteSession`

### 6. Create Index Exports

File: `packages/core/src/session/index.ts`
Export `SessionManager`, `MessageWindow`, `TokenBudget`.

File: `packages/core/src/repository/index.ts`
Export `SessionRepository`.

File: `packages/core/src/events/index.ts`
Export `SessionEventEmitter`.

## Validation

- [ ] All TypeScript compiles
- [ ] `SessionManager.createSession` cannot be overwritten by `options` spread
- [ ] `MessageWindow` has no mutable state
- [ ] Event emitter is named `SessionEventEmitter`
- [ ] Repository methods validate inputs
- [ ] Unit tests cover all public methods (>80% coverage)

## Common Pitfalls

- **Do NOT** use the `uuid` package — use Node.js built-in `crypto.randomUUID()`
- **Do NOT** make `MessageWindow` stateful — it should be a pure utility
- **Do NOT** swallow event handler errors — log them but don't crash
- **Do NOT** forget to update `lastActivityAt` on every mutating operation
