import { describe, it, expect } from 'vitest';
import { TokenBudget } from '../src/session/TokenBudget.js';
import type { TokenBudgetConfig } from '../src/types/token.js';

describe('TokenBudget', () => {
  const config: TokenBudgetConfig = {
    maxTokens: 4096,
    reserveTokens: 500,
    overflowStrategy: 'truncate',
  };

  it('calculates available tokens correctly', () => {
    const budget = new TokenBudget(config);
    expect(budget.getAvailableTokens(1000)).toBe(2596);
    expect(budget.getAvailableTokens(3596)).toBe(0);
    expect(budget.getAvailableTokens(4000)).toBe(0);
  });

  it('detects budget overflow', () => {
    const budget = new TokenBudget(config);
    expect(budget.wouldExceedBudget(3000, 100)).toBe(false);
    expect(budget.wouldExceedBudget(3500, 200)).toBe(true);
  });

  it('returns correct status', () => {
    const budget = new TokenBudget(config);
    const status = budget.getStatus(3000);
    expect(status.usedTokens).toBe(3000);
    expect(status.availableTokens).toBe(596);
    expect(status.maxTokens).toBe(4096);
    expect(status.percentage).toBeCloseTo(73.2, 0.1);
    expect(status.isOverBudget).toBe(false);
    expect(status.severity).toBe('normal');
  });

  it('returns warning severity between 75% and 90%', () => {
    const budget = new TokenBudget(config);
    const status = budget.getStatus(3200);
    expect(status.severity).toBe('warning');
  });

  it('returns critical severity above 90%', () => {
    const budget = new TokenBudget(config);
    const status = budget.getStatus(3700);
    expect(status.severity).toBe('critical');
  });
});
