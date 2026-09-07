import { describe, expect, it } from 'vitest';
import { addCompletion, EMPTY_SPEND, formatSpend } from './spend';
import type { CatalogModel } from './openrouter-catalog';

const NOW = 1_700_000_000_000;

const model = (id: string, price: number): CatalogModel => ({
  id,
  name: id,
  contextLength: 128_000,
  promptPrice: price,
  completionPrice: price,
  isFree: price === 0,
  isText: true,
});

const CATALOGUE = [model('vendor/free:free', 0), model('google/lyria-3-clip-preview-20260330', 0.0001)];

describe('addCompletion', () => {
  it('counts a free request without adding to the total', () => {
    const spend = addCompletion(
      EMPTY_SPEND,
      { model: 'vendor/free:free', usage: { input: 400, output: 100 } },
      CATALOGUE,
      NOW
    );
    expect(spend).toMatchObject({ requests: 1, inputTokens: 400, outputTokens: 100, usd: 0, paid: 0 });
  });

  it('prices the request that actually charged', () => {
    // 393 prompt + 102 completion on the music preview, from the OpenRouter
    // generation record. The point is that it shows up at all.
    const spend = addCompletion(
      EMPTY_SPEND,
      { model: 'google/lyria-3-clip-preview-20260330', usage: { input: 393, output: 102 } },
      CATALOGUE,
      NOW
    );
    expect(spend.paid).toBe(1);
    expect(spend.usd).toBeCloseTo(0.0495, 4);
  });

  it('records a model it cannot price rather than dropping the request', () => {
    const spend = addCompletion(EMPTY_SPEND, { model: 'who/knows', usage: { input: 10, output: 5 } }, [], NOW);
    expect(spend).toMatchObject({ requests: 1, unpriced: 1, paid: 0 });
  });

  it('survives a provider that reports no usage', () => {
    expect(addCompletion(EMPTY_SPEND, { model: 'vendor/free:free' }, CATALOGUE, NOW).requests).toBe(1);
  });

  it('keeps the first start time across later requests', () => {
    const first = addCompletion(EMPTY_SPEND, { model: 'vendor/free:free' }, CATALOGUE, NOW);
    const second = addCompletion(first, { model: 'vendor/free:free' }, CATALOGUE, NOW + 60_000);
    expect(second.since).toBe(NOW);
  });
});

describe('formatSpend', () => {
  it('says nothing has been sent rather than showing a zero', () => {
    expect(formatSpend(EMPTY_SPEND)).toBe('Nothing sent yet');
  });

  it('says free when nothing was charged', () => {
    expect(formatSpend({ ...EMPTY_SPEND, requests: 12 })).toBe('12 requests, free');
  });

  it('does not round a real charge down to nothing', () => {
    // "$0.00" would read as "free", which is the misreading that matters here.
    expect(formatSpend({ ...EMPTY_SPEND, requests: 3, paid: 1, usd: 0.004 })).toBe('3 requests, under a cent');
  });

  it('shows the amount once it is worth showing', () => {
    expect(formatSpend({ ...EMPTY_SPEND, requests: 5, paid: 5, usd: 0.2 })).toBe('5 requests, $0.20');
  });
});
