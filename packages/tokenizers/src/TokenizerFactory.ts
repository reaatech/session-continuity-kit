import type { TokenCounter, Logger } from '@session-continuity-kit/core';
import { createRequire } from 'node:module';
import { TiktokenTokenizer } from './TiktokenTokenizer.js';
import { EstimateTokenizer } from './EstimateTokenizer.js';

const OPENAI_MODELS = [
  'gpt-4',
  'gpt-4-turbo',
  'gpt-4-32k',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-3.5-turbo',
  'text-davinci-003',
  'text-embedding-ada-002',
  'text-embedding-3-small',
  'text-embedding-3-large',
];

const ANTHROPIC_MODELS = [
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
  'claude-2.1',
  'claude-2.0',
  'claude-instant-1.2',
];

/**
 * Factory for creating token counter instances by model name.
 * Supports OpenAI, Anthropic, and custom registered models.
 *
 * @example
 * ```typescript
 * const tokenizer = TokenizerFactory.create('gpt-4');
 * const models = TokenizerFactory.getSupportedModels();
 * ```
 */
export class TokenizerFactory {
  private static registry: Map<string, new () => TokenCounter> = new Map();
  private static logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
  };

  /**
   * Set a custom logger for the factory. Defaults to using `console.warn`
   * for warnings when the optional `@anthropic-ai/tokenizer` peer dependency
   * is not installed.
   *
   * @param logger - Logger implementation (pass `undefined` to suppress warnings)
   */
  static setLogger(logger: Logger | undefined): void {
    if (logger) {
      TokenizerFactory.logger = logger;
    } else {
      TokenizerFactory.logger = {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      };
    }
  }

  /**
   * Create a token counter for the given model.
   *
   * @param model - Model name (e.g. 'gpt-4', 'claude-3-sonnet')
   * @returns Token counter instance
   */
  static create(model: string): TokenCounter {
    // Try exact match first
    if (TokenizerFactory.registry.has(model)) {
      const Constructor = TokenizerFactory.registry.get(model);
      if (Constructor) return new Constructor();
    }

    // Known OpenAI models
    if (OPENAI_MODELS.some((m) => model.startsWith(m))) {
      return new TiktokenTokenizer(model);
    }

    // Known Anthropic models
    if (ANTHROPIC_MODELS.some((m) => model.startsWith(m))) {
      // Anthropic tokenizer is optional peer dependency
      try {
        const require = createRequire(import.meta.url);
        const { AnthropicTokenizer } = require('./AnthropicTokenizer.js');
        return new AnthropicTokenizer(model);
      } catch (err) {
        // Only swallow module-not-found errors; re-throw real bugs
        if (
          err instanceof Error &&
          (err.message.includes('Cannot find module') ||
            err.message.includes('MODULE_NOT_FOUND') ||
            err.message.includes('ERR_MODULE_NOT_FOUND'))
        ) {
          TokenizerFactory.logger.warn(
            `[@session-continuity-kit/tokenizers] '@anthropic-ai/tokenizer' is not installed; ` +
              `falling back to EstimateTokenizer for model '${model}'. ` +
              `Install the package for accurate counts.`
          );
        } else {
          throw err;
        }
      }
    }

    // Fallback
    return new EstimateTokenizer();
  }

  /**
   * Register a custom tokenizer for a model name.
   *
   * @param name - Model name
   * @param tokenizer - Tokenizer constructor
   */
  static register(name: string, tokenizer: new () => TokenCounter): void {
    TokenizerFactory.registry.set(name, tokenizer);
  }

  /**
   * Get the list of supported model names.
   *
   * @returns Array of supported model names
   */
  static getSupportedModels(): string[] {
    return [...OPENAI_MODELS, ...ANTHROPIC_MODELS, ...TokenizerFactory.registry.keys()];
  }
}
