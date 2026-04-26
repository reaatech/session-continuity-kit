# Skill: Code Review

## Purpose

Review code changes for quality, type safety, architecture adherence, and test coverage.

## When to Use

- Before merging any PR
- After implementing a feature
- When coverage drops or lint fails

## Step-by-Step Instructions

### 1. Automated Pre-Review

Run these commands and ensure they pass before manual review:

```bash
pnpm type-check   # TypeScript strict mode
pnpm lint         # ESLint with no errors
pnpm format:check # Prettier formatting
pnpm test         # All tests pass
pnpm test:coverage # Coverage thresholds met
```

If any command fails, request fixes before proceeding.

### 2. Checklist Review

Go through each category systematically:

#### Type Safety

- [ ] No `any` types in public API
- [ ] All function parameters have explicit types
- [ ] Return types are explicit
- [ ] Null/undefined handling is explicit (no implicit nulls)

#### Code Quality

- [ ] Functions are small and focused (<50 lines ideally)
- [ ] No code duplication — extract shared logic
- [ ] No `console.log` in production code
- [ ] Async operations use proper error handling

#### Architecture

- [ ] Layered architecture is maintained
- [ ] Dependencies point inward (adapters depend on core interfaces, not vice versa)
- [ ] Single responsibility principle holds
- [ ] No circular dependencies

#### Testing

- [ ] Unit tests cover all code paths including errors
- [ ] Edge cases tested (empty arrays, boundary values)
- [ ] Tests are independent (no shared state)
- [ ] Mock external dependencies

#### Documentation

- [ ] All public APIs have JSDoc with `@example`
- [ ] Complex logic has inline comments
- [ ] README/docs updated if behavior changed

#### Performance

- [ ] Token counts cached where appropriate
- [ ] No N+1 queries in adapters
- [ ] Large datasets handled with pagination/streams

#### Security

- [ ] Input validation present
- [ ] No injection vulnerabilities (parameterized queries)
- [ ] Error messages don't leak internals

### 3. Provide Feedback

- Be specific: cite line numbers and suggest code
- Categorize as: `blocking` (must fix), `suggestion` (nice to have), `question` (needs clarification)
- Verify fixes in follow-up review

## Validation

- [ ] All automated checks pass
- [ ] No blocking issues remain
- [ ] At least one approval from code owner

## Common Pitfalls

- **Do NOT** approve with failing CI — ever
- **Do NOT** ignore type safety warnings — `unknown` is fine, `any` is not
- **Do NOT** let test coverage slip — 100% core is the standard
- **Do NOT** forget to check for `uuid` imports — use `crypto.randomUUID()` instead
