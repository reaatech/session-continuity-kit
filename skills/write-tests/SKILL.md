# Skill: Write Tests

## Purpose

Generate comprehensive test suites for all packages using Vitest.

## When to Use

- After implementing any package or feature
- When coverage drops below targets
- When adding new adapters or strategies

## Prerequisites

- Vitest configured in the workspace
- `pnpm test` runs successfully (even if empty)

## Step-by-Step Instructions

### 1. Test Utilities & Fixtures

Create shared test utilities:

- `tests/fixtures/session-factories.ts` — helper functions to create `Session` objects with defaults
- `tests/fixtures/message-factories.ts` — helper functions to create `Message` objects
- `tests/helpers/mock-storage-adapter.ts` — `IStorageAdapter` mock using `MemoryAdapter` or `vi.fn()`
- `tests/helpers/mock-token-counter.ts` — `TokenCounter` mock that returns predictable counts
- `tests/helpers/test-utils.ts` — async helpers, date manipulation, etc.

### 2. Core Unit Tests

Create under `packages/core/tests/`:

- `SessionManager.test.ts`
  - Session lifecycle (create, get, update, end, delete)
  - Message operations
  - Token budget enforcement
  - Compression orchestration
  - Agent handoff
  - Event emission
  - Cleanup job
  - Error handling (SessionNotFoundError, etc.)
- `MessageWindow.test.ts`
  - Fitting messages within budget
  - System message preservation
  - Empty message list
  - Exact budget boundary
- `TokenBudget.test.ts`
  - Budget calculations
  - Overflow detection
  - Status severity levels
- `SessionRepository.test.ts`
  - CRUD operations
  - Query filtering
  - Input validation

### 3. Compression Strategy Tests

Create under `packages/core/tests/compression/`:

- `SlidingWindowStrategy.test.ts`
  - Empty list, under budget, over budget
  - `minMessages` / `maxMessages` boundaries
  - System message preservation
- `SummarizationStrategy.test.ts`
  - Mock summarizer integration
  - No-op when under budget
  - Summary message creation
  - Error handling when summarizer fails
- `HybridStrategy.test.ts`
  - Recent message preservation
  - Summary + fallback to sliding window
  - All edge cases above

### 4. Adapter Integration Tests

Create under each `packages/storage-*/tests/`:

- `MemoryAdapter.test.ts` — full CRUD, TTL simulation, filtering
- `FirestoreAdapter.test.ts` — mocked Firestore client or emulator
- `DynamoDBAdapter.test.ts` — mocked DynamoDB client or Local DynamoDB
- `RedisAdapter.test.ts` — mocked Redis client or test Redis instance

Each adapter test should cover:

- Session CRUD
- Message CRUD and querying
- `listSessions` with various filters
- `getExpiredSessions`
- Health check
- Close / cleanup

### 5. Tokenizer Tests

Create under `packages/tokenizers/tests/`:

- `TiktokenTokenizer.test.ts` — accuracy against known counts
- `AnthropicTokenizer.test.ts` — accuracy if package available
- `EstimateTokenizer.test.ts` — rough accuracy bounds
- `TokenizerFactory.test.ts` — model mapping, custom registration

### 6. E2E Tests

Create under `tests/e2e/`:

- `session-lifecycle.test.ts` — create → messages → compression → end
- `compression-pipeline.test.ts` — all three strategies end-to-end
- `agent-handoff.test.ts` — handoff between agents with context preservation
- `multi-participant.test.ts` — multiple participants joining/leaving

## Coverage Targets

- `packages/core`: **100%** for all files
- `packages/tokenizers`: **>90%**
- Storage adapters: **>80%** (integration test coverage)

## Validation

- [ ] `pnpm test` passes
- [ ] `pnpm test:coverage` meets targets
- [ ] Tests are independent (no shared mutable state)
- [ ] Tests use mocks for external dependencies (Firestore, DynamoDB, Redis)
- [ ] No `console.log` in tests — use `vi.spyOn(console, ...)` if needed

## Common Pitfalls

- **Do NOT** test against real cloud services in unit tests — always mock or use emulators
- **Do NOT** share mutable state between tests — each test should create fresh fixtures
- **Do NOT** skip error paths — 100% coverage means errors too
- **Do NOT** use `setTimeout` in tests without `vi.useFakeTimers()`
- **Do NOT** forget to test the cleanup job in `SessionManager` (use fake timers)
