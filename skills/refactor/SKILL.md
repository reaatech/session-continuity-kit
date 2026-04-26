# Skill: Refactor

## Purpose

Improve code structure, readability, or performance without changing external behavior.

## When to Use

- Code review feedback requires structural changes
- Technical debt needs reduction
- Performance optimization

## Prerequisites

- All tests pass before starting
- Git working tree is clean (or changes are committed)

## Step-by-Step Instructions

### 1. Establish Baseline

```bash
pnpm test        # Must pass
pnpm type-check  # Must pass
```

### 2. Identify Target

Common refactor targets in this codebase:

| Smell                                              | Solution                                   |
| -------------------------------------------------- | ------------------------------------------ |
| Method > 50 lines                                  | Extract Method                             |
| Class has > 5 responsibilities                     | Extract Class                              |
| Duplicate logic across strategies                  | Extract shared utility                     |
| Long parameter list (>4 params)                    | Introduce Parameter Object                 |
| Complex if/else on strategy type                   | Already using Strategy pattern — verify it |
| Feature Envy (adapter knows too much about domain) | Move logic to Repository or Manager        |

### 3. Execute Incrementally

Make one change at a time:

1. Extract method / class / interface
2. Run `pnpm type-check`
3. Run `pnpm test`
4. Commit

Repeat until refactor is complete.

### 4. Verify Behavior

- [ ] All tests pass
- [ ] TypeScript compiles
- [ ] No public API signatures changed (unless intentional)
- [ ] Coverage maintained or improved
- [ ] No `any` types introduced

## Specific Refactor Patterns for This Project

### Extract Shared Compression Logic

If sliding window logic appears in both `SlidingWindowStrategy` and `HybridStrategy`, extract to `packages/core/src/compression/utils.ts`:

```typescript
export function fitMessagesWithinBudget(
  messages: Message[],
  budget: number,
  counter: TokenCounter
): { kept: Message[]; removed: Message[] } { ... }
```

### Normalize Adapter Serialization

If all adapters repeat Date serialization logic, extract to core:

```typescript
export function serializeSession(session: Session): SerializedSession;
export function deserializeSession(data: unknown): Session;
```

### Reduce SessionManager Size

If `SessionManager` grows beyond ~300 lines, consider extracting:

- `SessionLifecycleService`
- `MessageService`
- `CompressionService`

## Validation

- [ ] Tests pass before and after
- [ ] No behavior changes (except intentional bug fixes)
- [ ] Coverage maintained
- [ ] TypeScript strict mode passes

## Common Pitfalls

- **Do NOT** refactor and fix bugs in the same commit — separate concerns
- **Do NOT** change public API during a refactor unless explicitly planned
- **Do NOT** skip tests after each small change — catch regressions early
- **Do NOT** introduce new dependencies during a refactor
