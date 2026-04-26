# @session-continuity-kit/tokenizers

Token counting utilities for OpenAI and Anthropic models.

## Installation

```bash
npm install @session-continuity-kit/tokenizers
```

## Usage

```typescript
import {
  TiktokenTokenizer,
  EstimateTokenizer,
  TokenizerFactory,
} from '@session-continuity-kit/tokenizers';

// OpenAI models
const openai = new TiktokenTokenizer('gpt-4');

// Fast estimation
const estimate = new EstimateTokenizer(4);

// Factory
const tokenizer = TokenizerFactory.create('gpt-4');
```
