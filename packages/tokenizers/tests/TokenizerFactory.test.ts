import { describe, it, expect } from 'vitest';
import { TokenizerFactory } from '../src/TokenizerFactory.js';
import { TiktokenTokenizer } from '../src/TiktokenTokenizer.js';
import { EstimateTokenizer } from '../src/EstimateTokenizer.js';
import type { TokenCounter } from '@reaatech/session-continuity';

describe('TokenizerFactory', () => {
  it('creates TiktokenTokenizer for OpenAI models', () => {
    const tokenizer = TokenizerFactory.create('gpt-4');
    expect(tokenizer).toBeInstanceOf(TiktokenTokenizer);
    expect(tokenizer.model).toBe('gpt-4');
  });

  it('creates TiktokenTokenizer for gpt-3.5-turbo', () => {
    const tokenizer = TokenizerFactory.create('gpt-3.5-turbo');
    expect(tokenizer).toBeInstanceOf(TiktokenTokenizer);
  });

  it('creates TiktokenTokenizer for model prefixes', () => {
    const tokenizer = TokenizerFactory.create('gpt-4-1106-preview');
    expect(tokenizer).toBeInstanceOf(TiktokenTokenizer);
  });

  it('falls back to EstimateTokenizer for unknown models', () => {
    const tokenizer = TokenizerFactory.create('unknown-model-xyz');
    expect(tokenizer).toBeInstanceOf(EstimateTokenizer);
  });

  it('registers custom tokenizer', () => {
    class CustomTokenizer implements TokenCounter {
      count() {
        return 42;
      }
      countMessages() {
        return 42;
      }
      model = 'custom';
      tokenizer = 'custom';
    }

    TokenizerFactory.register('custom-model', CustomTokenizer);
    try {
      const tokenizer = TokenizerFactory.create('custom-model');
      expect(tokenizer).toBeInstanceOf(CustomTokenizer);
      expect(tokenizer.count('anything')).toBe(42);
    } finally {
      // Clean up registered tokenizer to avoid polluting other tests
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (TokenizerFactory as any).registry.delete('custom-model');
    }
  });

  it('returns supported models list', () => {
    const models = TokenizerFactory.getSupportedModels();
    expect(models).toContain('gpt-4');
    expect(models).toContain('gpt-3.5-turbo');
    expect(models).toContain('claude-3-opus');
    expect(models.length).toBeGreaterThan(5);
  });

  it('attempts Anthropic tokenizer for Claude models', () => {
    // Anthropic tokenizer is optional and likely not installed,
    // so it should fall back to EstimateTokenizer
    const tokenizer = TokenizerFactory.create('claude-3-opus-20240229');
    expect(tokenizer).toBeDefined();
    expect(tokenizer).toBeInstanceOf(EstimateTokenizer);
  });
});
