# @reaatech/session-continuity-tokenizers

[![npm version](https://img.shields.io/npm/v/@reaatech/session-continuity-tokenizers.svg)](https://www.npmjs.com/package/@reaatech/session-continuity-tokenizers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/session-continuity-kit/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/session-continuity-kit/ci.yml?branch=main&label=CI)](https://github.com/reaatech/session-continuity-kit/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Token counting implementations implementing the `TokenCounter` interface from `@reaatech/session-continuity`. Provides three tokenizers — exact WASM-based tiktoken (OpenAI), exact Anthropic, and a fast heuristic estimator — plus a factory that auto-selects the right tokenizer by model name.

## Installation

```bash
npm install @reaatech/session-continuity-tokenizers
# or
pnpm add @reaatech/session-continuity-tokenizers
```

For Anthropic token counting, install the optional peer dependency:

```bash
npm install @anthropic-ai/tokenizer
```

## Feature Overview

- **`TiktokenTokenizer`** — exact token counts for OpenAI models via WASM-based `tiktoken` (supports `gpt-4`, `gpt-4o`, `gpt-3.5-turbo`, `text-davinci-003`, embedding models)
- **`AnthropicTokenizer`** — exact token counts for Anthropic models (lazy-loads `@anthropic-ai/tokenizer`; falls back gracefully if not installed)
- **`EstimateTokenizer`** — fast heuristic: `Math.ceil(text.length / charsPerToken)` with configurable ratio
- **`TokenizerFactory`** — auto-selects the correct tokenizer by model name; supports custom registry for user-defined models
- **Consistent message counting** — per-message overhead (3 tokens for role) plus 3 tokens for the message list, accounting for tool calls/results

## Quick Start

```typescript
import {
  TiktokenTokenizer,
  AnthropicTokenizer,
  EstimateTokenizer,
  TokenizerFactory,
} from '@reaatech/session-continuity-tokenizers';

// Exact: OpenAI
const openai = new TiktokenTokenizer('gpt-4');
openai.count('Hello, world!'); // → exact token count
openai.countMessages(messages); // → token count with overhead

// Exact: Anthropic
const claude = new AnthropicTokenizer('claude-3-sonnet');

// Fast: heuristic
const estimate = new EstimateTokenizer(4); // 4 chars per token

// Auto-select by model name
const auto = TokenizerFactory.create('gpt-4o');
```

## API Reference

### `TiktokenTokenizer`

#### Constructor

```typescript
new TiktokenTokenizer(model?: string)  // default: "gpt-4"
```

**Model-to-encoding mappings:**

| Model                                                                        | Encoding      |
| ---------------------------------------------------------------------------- | ------------- |
| `gpt-4`, `gpt-4-turbo`, `gpt-4-32k`                                          | `cl100k_base` |
| `gpt-4o`, `gpt-4o-mini`                                                      | `o200k_base`  |
| `gpt-3.5-turbo`                                                              | `cl100k_base` |
| `text-davinci-003`                                                           | `p50k_base`   |
| `text-embedding-ada-002`, `text-embedding-3-small`, `text-embedding-3-large` | `cl100k_base` |

Unknown models fall back to `cl100k_base`.

#### Public Methods

| Method                    | Returns      | Description                                                        |
| ------------------------- | ------------ | ------------------------------------------------------------------ |
| `count(text)`             | `number`     | Exact token count via WASM-based tiktoken                          |
| `countMessages(messages)` | `number`     | Total tokens including per-message overhead and tool calls/results |
| `dispose()`               | `void`       | Frees WASM encoding resources                                      |
| `model` (getter)          | `string`     | The model name                                                     |
| `tokenizer` (getter)      | `"tiktoken"` | Tokenizer name                                                     |

### `AnthropicTokenizer`

#### Constructor

```typescript
new AnthropicTokenizer(model?: string)  // default: "claude-3-sonnet"
```

Requires optional peer dependency `@anthropic-ai/tokenizer`. Lazy-loads on first `count()` call.

#### Public Methods

| Method                    | Returns       | Description                                    |
| ------------------------- | ------------- | ---------------------------------------------- |
| `count(text)`             | `number`      | Exact token count via Anthropic tokenizer      |
| `countMessages(messages)` | `number`      | Total tokens with overhead and tool accounting |
| `dispose()`               | `void`        | Frees encoding resources if supported          |
| `model` (getter)          | `string`      | The model name                                 |
| `tokenizer` (getter)      | `"anthropic"` | Tokenizer name                                 |

### `EstimateTokenizer`

#### Constructor

```typescript
new EstimateTokenizer(charsPerToken?: number)  // default: 4
```

Throws if `charsPerToken <= 0`.

#### Public Methods

| Method                    | Returns      | Description                              |
| ------------------------- | ------------ | ---------------------------------------- |
| `count(text)`             | `number`     | `Math.ceil(text.length / charsPerToken)` |
| `countMessages(messages)` | `number`     | Estimated total with overhead            |
| `dispose()`               | `void`       | No-op                                    |
| `model` (getter)          | `"estimate"` | Model name                               |
| `tokenizer` (getter)      | `"estimate"` | Tokenizer name                           |

### `TokenizerFactory`

#### Static Methods

| Method               | Signature                                            | Description                                                                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`             | `(model: string): TokenCounter`                      | Auto-selects by model name. OpenAI → `TiktokenTokenizer`, Anthropic → `AnthropicTokenizer` (falls back to `EstimateTokenizer` with warning if `@anthropic-ai/tokenizer` not installed). Custom-registered models use registered constructor. Ultimate fallback: `EstimateTokenizer(4)`. |
| `register`           | `(name: string, ctor: new () => TokenCounter): void` | Register a custom tokenizer                                                                                                                                                                                                                                                             |
| `getSupportedModels` | `(): string[]`                                       | All known model names + registry keys                                                                                                                                                                                                                                                   |
| `setLogger`          | `(logger: Logger \| undefined): void`                | Custom logger for warnings (pass `undefined` to suppress)                                                                                                                                                                                                                               |

**Recognized model prefixes:**

| Prefix                                     | Matches          | Tokenizer            |
| ------------------------------------------ | ---------------- | -------------------- |
| `gpt-`, `text-davinci-`, `text-embedding-` | OpenAI models    | `TiktokenTokenizer`  |
| `claude-`                                  | Anthropic models | `AnthropicTokenizer` |

## Usage Patterns

### With SessionManager

```typescript
import { SessionManager } from '@reaatech/session-continuity';
import { TiktokenTokenizer } from '@reaatech/session-continuity-tokenizers';

const manager = new SessionManager({
  storage: myStorage,
  tokenCounter: new TiktokenTokenizer('gpt-4o'),
  tokenBudget: { maxTokens: 128000, reserveTokens: 4096, overflowStrategy: 'compress' },
});
```

### Registering a Custom Tokenizer

```typescript
import { TokenizerFactory } from '@reaatech/session-continuity-tokenizers';
import type { TokenCounter, Message } from '@reaatech/session-continuity';

class MyCustomTokenizer implements TokenCounter {
  readonly model = 'my-model';
  readonly tokenizer = 'custom';

  count(text: string): number {
    /* ... */ return 0;
  }
  countMessages(messages: Message[]): number {
    /* ... */ return 0;
  }
  dispose(): void {}
}

TokenizerFactory.register('my-model', () => new MyCustomTokenizer());
const tokenizer = TokenizerFactory.create('my-model');
```

### Standalone Token Counting

```typescript
import { TiktokenTokenizer } from '@reaatech/session-continuity-tokenizers';
import type { Message } from '@reaatech/session-continuity';

const tokenizer = new TiktokenTokenizer('gpt-4');

// Count a single string
const promptTokens = tokenizer.count('Explain quantum computing in simple terms.');

// Count an array of messages (includes role overhead)
const messages: Message[] = [
  { id: '1', sessionId: 's1', role: 'system', content: 'You are helpful.', createdAt: new Date() },
  { id: '2', sessionId: 's1', role: 'user', content: 'Hello!', createdAt: new Date() },
];
const totalTokens = tokenizer.countMessages(messages);

// Clean up when done
tokenizer.dispose();
```

## Related Packages

- [`@reaatech/session-continuity`](https://www.npmjs.com/package/@reaatech/session-continuity) — Core types, `TokenCounter` interface, and `SessionManager` (primary consumer)
- [`@reaatech/session-continuity-storage-memory`](https://www.npmjs.com/package/@reaatech/session-continuity-storage-memory) — In-memory storage adapter

## License

[MIT](https://github.com/reaatech/session-continuity-kit/blob/main/LICENSE)
