# Skill: Implement Tokenizers

## Purpose

Create token counting implementations for OpenAI, Anthropic, and fast estimation fallback.

## When to Use

- Phase 1 (after core types)
- When adding support for a new LLM model

## Prerequisites

- `TokenCounter` interface defined in `packages/core/src/types/token.ts`
- `packages/tokenizers/src/` directory exists

## Step-by-Step Instructions

### 1. Implement `TiktokenTokenizer`

File: `packages/tokenizers/src/TiktokenTokenizer.ts`

- Constructor takes a **model name** (e.g., `'gpt-4'`, `'gpt-3.5-turbo'`)
- Use `tiktoken.encodingForModel(model)` to get the correct encoding — **NOT** `getEncoding(model)`
- `count(text): number` — encode and return length
- `countMessages(messages): number` — apply per-message overhead (+3 per message, +3 for list), include tool call tokens
- `model` getter returns the model name passed to constructor
- `tokenizer` getter returns `'tiktoken'`
- Supported models: `gpt-4`, `gpt-4-turbo`, `gpt-4-32k`, `gpt-3.5-turbo`, `text-embedding-ada-002`

### 2. Implement `AnthropicTokenizer`

File: `packages/tokenizers/src/AnthropicTokenizer.ts`

- Constructor takes a model name
- Use `@anthropic-ai/tokenizer` WASM tokenizer
- Same interface as `TiktokenTokenizer`
- `tokenizer` getter returns `'anthropic'`
- Supported models: `claude-3-opus`, `claude-3-sonnet`, `claude-3-haiku`, `claude-2.1`, `claude-2.0`

### 3. Implement `EstimateTokenizer`

File: `packages/tokenizers/src/EstimateTokenizer.ts`

- Fast fallback using character count / `charsPerToken` (default 4)
- `countMessages` adds overhead of 3 tokens per message
- Use this when exact counting isn't needed or tiktoken/anthropic packages aren't available

### 4. Implement `TokenizerFactory`

File: `packages/tokenizers/src/TokenizerFactory.ts`

- `create(model: string): TokenCounter`
- Map known model names to the correct tokenizer
- For unknown models, return `EstimateTokenizer` with a warning (or throw if strict mode enabled)
- `register(name: string, tokenizer: TokenCounter): void` for custom tokenizers
- `getSupportedModels(): string[]`

### 5. Create Index Export

File: `packages/tokenizers/src/index.ts`
Export all tokenizers and the factory.

### 6. Tests

Create tests for:

- Known token counts for sample strings
- Message list overhead calculations
- Tool call token counting
- Factory creation for all supported models
- Fallback behavior for unknown models
- Edge cases: empty string, unicode, very long text

## Validation

- [ ] `TiktokenTokenizer` uses `encodingForModel`, not `getEncoding`
- [ ] Accuracy tests pass against known OpenAI tokenizer counts
- [ ] Factory returns correct tokenizer for each supported model
- [ ] Unknown models fall back to `EstimateTokenizer`
- [ ] Performance: <1ms for typical message counting
- [ ] No `any` types in public API

## Common Pitfalls

- **Do NOT** call `getEncoding('gpt-4')` — it will fail. Use `encodingForModel('gpt-4')`.
- **Do NOT** forget to handle `@anthropic-ai/tokenizer` being an optional peer dependency
- **Do NOT** forget message overhead in `countMessages` — LLM APIs charge per-message overhead
- **Do NOT** load the WASM tokenizer synchronously if it causes startup delays — consider lazy initialization
