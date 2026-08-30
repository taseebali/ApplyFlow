import { describe, expect, it } from 'vitest';
import { formatCost, summarizeRunCost } from './run-cost';
import type { CatalogModel } from './openrouter-catalog';

const model = (id: string, price: number, isFree = price === 0): CatalogModel => ({
  id,
  name: id,
  contextLength: 128000,
  promptPrice: price,
  completionPrice: price * 2,
  isFree,
});

const catalogue = [model('free/one', 0), model('paid/one', 0.000001)];

describe('summarizeRunCost', () => {
  it('adds up tokens across every question in a run', () => {
    const cost = summarizeRunCost(
      [
        { model: 'paid/one', input: 1000, output: 200 },
        { model: 'paid/one', input: 500, output: 100 },
      ],
      catalogue
    );
    expect(cost.inputTokens).toBe(1500);
    expect(cost.outputTokens).toBe(300);
  });

  it('prices a paid run from the catalogue', () => {
    const cost = summarizeRunCost([{ model: 'paid/one', input: 1_000_000, output: 0 }], catalogue);
    expect(cost.usd).toBeCloseTo(1);
    expect(cost.free).toBe(false);
  });

  it('reports a free-model run as free', () => {
    const cost = summarizeRunCost([{ model: 'free/one', input: 5000, output: 900 }], catalogue);
    expect(cost.free).toBe(true);
    expect(cost.usd).toBe(0);
  });

  it('is not "free" when a run mixed a free model with a paid one', () => {
    // The rotating pool makes this the interesting case.
    const cost = summarizeRunCost(
      [
        { model: 'free/one', input: 100, output: 10 },
        { model: 'paid/one', input: 100, output: 10 },
      ],
      catalogue
    );
    expect(cost.free).toBe(false);
  });

  it('reports an unknown price as unknown rather than as free', () => {
    const cost = summarizeRunCost([{ model: 'mystery/model', input: 100, output: 10 }], catalogue);
    expect(cost.usd).toBeNull();
    expect(cost.free).toBe(false);
  });
});

describe('formatCost', () => {
  it('says free when it was free', () => {
    expect(formatCost({ inputTokens: 100, outputTokens: 20, usd: 0, free: true })).toBe('120 tokens, free');
  });

  it('does not round a real cost down to zero', () => {
    expect(formatCost({ inputTokens: 1, outputTokens: 1, usd: 0.0004, free: false })).toContain('under a cent');
  });

  it('shows tokens alone when no price is known', () => {
    expect(formatCost({ inputTokens: 10, outputTokens: 5, usd: null, free: false })).toBe('15 tokens');
  });
});
