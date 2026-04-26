import type { TokenBudgetConfig, BudgetStatus } from '../types/token.js';

export class TokenBudget {
  constructor(private config: TokenBudgetConfig) {}

  /**
   * Check if adding a message would exceed budget.
   */
  wouldExceedBudget(currentTokens: number, additionalTokens: number): boolean {
    const available = this.getAvailableTokens(currentTokens);
    return additionalTokens > available;
  }

  /**
   * Calculate available tokens.
   */
  getAvailableTokens(usedTokens: number): number {
    const { maxTokens, reserveTokens } = this.config;
    return Math.max(0, maxTokens - reserveTokens - usedTokens);
  }

  /**
   * Get budget status.
   */
  getStatus(usedTokens: number): BudgetStatus {
    const available = this.getAvailableTokens(usedTokens);
    const percentage = (usedTokens / this.config.maxTokens) * 100;

    return {
      usedTokens,
      availableTokens: available,
      maxTokens: this.config.maxTokens,
      percentage,
      isOverBudget: available <= 0,
      severity: percentage > 90 ? 'critical' : percentage > 75 ? 'warning' : 'normal',
    };
  }
}
