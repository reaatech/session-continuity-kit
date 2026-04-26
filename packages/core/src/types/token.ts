import type { Message } from './session.js';

/** Token budget configuration */
export interface TokenBudgetConfig {
  /** Maximum tokens for the entire context window */
  maxTokens: number;
  /** Reserve tokens for system prompt and new response */
  reserveTokens: number;
  /**
   * Strategy when budget is exceeded:
   * - 'truncate': drop oldest non-system messages until budget fits
   * - 'compress': apply configured compression strategy
   * - 'error': throw TokenBudgetExceededError
   */
  overflowStrategy: 'truncate' | 'compress' | 'error';
}

/** Result of token counting operation */
export interface TokenCountResult {
  totalTokens: number;
  messageTokens: number;
  systemTokens: number;
  availableTokens: number;
  isOverBudget: boolean;
  overageTokens: number;
}

/** Budget status snapshot */
export interface BudgetStatus {
  usedTokens: number;
  availableTokens: number;
  maxTokens: number;
  percentage: number;
  isOverBudget: boolean;
  severity: 'normal' | 'warning' | 'critical';
}

/** Token counter interface */
export interface TokenCounter {
  /** Count tokens in a plain string */
  count(text: string): number;
  /** Count tokens in formatted messages (includes per-message overhead) */
  countMessages(messages: Message[]): number;
  /** Model this counter is configured for */
  readonly model: string;
  /** Name of the tokenizer implementation */
  readonly tokenizer: string;
}
