# Skill: Write Documentation

## Purpose

Write user-facing documentation, API references, examples, and README updates.

## When to Use

- Phase 5 (polish)
- After public API changes
- When adding new features or adapters

## Prerequisites

- Public API is stable
- Examples can run without errors

## Step-by-Step Instructions

### 1. README.md

Update/create `README.md` with:

- Project overview and key features
- Installation (`pnpm add @session-continuity-kit/core` etc.)
- Quick start with `MemoryAdapter`
- Storage adapters overview (table of supported backends)
- Compression strategies overview
- Basic configuration example
- Contributing link
- License

### 2. Getting Started Guide

Create `docs/getting-started.md`:

- Install core + adapter packages
- Create a session
- Add messages
- Get conversation context
- Configure token budgets
- Switch from `MemoryAdapter` to production storage

### 3. Storage Adapter Guides

Create `docs/storage-adapters.md`:

- Comparison table (Firestore vs DynamoDB vs Redis vs Memory)
- Setup instructions for each adapter
- Configuration options
- TTL behavior per adapter
- Redis `listSessions` limitations (document clearly)
- Custom adapter guide

### 4. Compression Strategies Guide

Create `docs/compression-strategies.md`:

- When to use sliding window (fast, deterministic, short conversations)
- When to use summarization (long conversations, semantic context matters)
- When to use hybrid (production default)
- Config examples for each
- Token budget configuration best practices
- `targetTokens` should be `maxTokens - reserveTokens - safetyMargin`

### 5. API Reference

Use TypeDoc to generate API docs from JSDoc:

- Ensure all public classes/methods have JSDoc
- Include `@example` tags
- Include `@throws` tags
- Run `typedoc` as part of build

### 6. Runnable Examples

Create under `examples/`:

- `basic-usage/` — minimal in-memory example
- `with-firestore/` — Firestore setup
- `with-dynamodb/` — DynamoDB setup
- `with-redis/` — Redis setup
- `with-compression/` — demonstrates all three strategies
- `agent-handoff/` — multi-agent example

Each example must:

- Have its own `package.json` with correct dependencies
- Have a `README.md` with run instructions
- Have TypeScript source that compiles

### 7. Migration Guide

Create `docs/migration-guide.md`:

- Mapping from custom session types to library types
- Adapter migration checklist
- Common patterns and how they map

## Validation

- [ ] All code examples compile and run
- [ ] All internal links are valid
- [ ] JSDoc coverage is 100% for public APIs
- [ ] README has all required sections
- [ ] No spelling errors (run `cspell` if available)

## Common Pitfalls

- **Do NOT** write documentation before API is stable — it creates churn
- **Do NOT** forget to document Redis `listSessions` limitations
- **Do NOT** use outdated API in examples — always test examples
- **Do NOT** forget to update docs when public API changes
