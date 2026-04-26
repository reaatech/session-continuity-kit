# Skill: Implement Compression Strategies

## Purpose

Create the compression strategy implementations that manage context window size: `SlidingWindowStrategy`, `SummarizationStrategy`, and `HybridStrategy`.

## When to Use

- Phase 2 implementation
- After core types and `SessionManager` are in place

## Prerequisites

- Core types compiled, especially `ICompressionStrategy`, `CompressionConfig` (discriminated union), `SummarizerService`
- `TokenCounter` implementation available for testing

## Step-by-Step Instructions

### 1. Create Base / Utility

File: `packages/core/src/compression/CompressionStrategy.ts`

- Export a helper `calculateMessageTokens(message, counter)` that respects `message.tokenCount` if cached
- Export a helper `preserveSystemMessages(messages)` that extracts and returns system messages
- No need for a full abstract class — strategies can implement `ICompressionStrategy` directly

### 2. Implement `SlidingWindowStrategy`

File: `packages/core/src/compression/SlidingWindowStrategy.ts`

- `type = 'sliding_window'`
- Algorithm:
  1. Separate system messages (always keep)
  2. Sort non-system by `createdAt` descending
  3. Greedily add from newest until `targetTokens` reached
  4. Respect `minMessages` if specified (keep at least that many even if over budget — emit warning)
  5. Respect `maxMessages` if specified (hard cap)
  6. Return `CompressionResult` with `removedMessages` populated

### 3. Implement `SummarizerService` Interface and Mock

File: `packages/core/src/compression/SummarizerService.ts`

```typescript
export interface SummarizerService {
  summarize(messages: Message[], prompt?: string): Promise<string>;
}
```

Also export a `MockSummarizerService` for testing that returns a deterministic string.

### 4. Implement `SummarizationStrategy`

File: `packages/core/src/compression/SummarizationStrategy.ts`

- `type = 'summarization'`
- Constructor receives `SummarizerService`
- Algorithm:
  1. Calculate total tokens
  2. If under budget, return early (no-op)
  3. Partition messages: determine how many recent messages to keep so that older ones can be summarized and fit within `targetTokens`
  4. Call `summarizer.summarize()` on the older partition
  5. Create a synthetic system message with the summary
  6. Return result with summary text

### 5. Implement `HybridStrategy`

File: `packages/core/src/compression/HybridStrategy.ts`

- `type = 'hybrid'`
- Constructor receives `SummarizerService`
- Algorithm:
  1. Keep system messages
  2. Keep last `maxMessages` (default 20) non-system messages as-is
  3. Summarize all older non-system messages
  4. Combine: system messages → summary message → recent messages
  5. If the resulting set still exceeds `targetTokens`, fall back to `SlidingWindowStrategy` on the combined set

### 6. Create Index Export

File: `packages/core/src/compression/index.ts`
Export all strategies and `SummarizerService`.

## Validation

- [ ] Each strategy has unit tests covering:
  - Empty message list
  - Messages under budget (no-op)
  - Messages over budget (compression occurs)
  - System messages always preserved
  - Token counts accurate before/after
- [ ] `HybridStrategy` falls back to sliding window if summary + recent messages still exceed budget
- [ ] Mock summarizer works deterministically for tests
- [ ] TypeScript compilation passes
- [ ] No `any` types in public API

## Common Pitfalls

- **Do NOT** assume messages are sorted — always sort by `createdAt`
- **Do NOT** mutate input `messages` array — return new arrays
- **Do NOT** forget to handle the case where `summarizer.summarize()` throws — wrap in `CompressionError`
- **Do NOT** make `HybridStrategy` silently lose messages — always include `removedMessages` in result
