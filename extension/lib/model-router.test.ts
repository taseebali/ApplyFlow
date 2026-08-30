import { describe, expect, it } from 'vitest';
import {
  COOLDOWN_MS,
  nextCandidates,
  policyFromLegacy,
  pruneCooldowns,
  withCooldown,
  type Cooldowns,
  type ModelPolicy,
} from './model-router';
import type { CatalogModel } from './openrouter-catalog';

const NOW = 1_000_000_000_000;

const model = (id: string, over: Partial<CatalogModel> = {}): CatalogModel => ({
  id,
  name: id,
  contextLength: 128_000,
  promptPrice: 0,
  completionPrice: 0,
  isFree: true,
  ...over,
});

const CATALOGUE = [
  model('free/big'),
  model('free/small', { contextLength: 4_000 }),
  model('paid/one', { isFree: false, promptPrice: 0.001 }),
  model('free/other'),
];

const base = { catalogue: CATALOGUE, cooldowns: {} as Cooldowns, now: NOW };

describe('single', () => {
  it('returns just that model', () => {
    expect(nextCandidates({ ...base, policy: { kind: 'single', model: 'a/one' } })).toEqual(['a/one']);
  });

  it('returns nothing when no model is set', () => {
    expect(nextCandidates({ ...base, policy: { kind: 'single', model: '' } })).toEqual([]);
  });

  it('still offers the only model even while it is cooling off', () => {
    expect(
      nextCandidates({
        ...base,
        cooldowns: { 'a/one': NOW + 1000 },
        policy: { kind: 'single', model: 'a/one' },
      })
    ).toEqual(['a/one']);
  });
});

describe('list', () => {
  const policy: ModelPolicy = { kind: 'list', models: ['a/one', 'b/two', 'c/three'] };

  it('keeps the order the user chose', () => {
    expect(nextCandidates({ ...base, policy })).toEqual(['a/one', 'b/two', 'c/three']);
  });

  it('moves a cooling model to the back rather than dropping it', () => {
    const candidates = nextCandidates({ ...base, cooldowns: { 'a/one': NOW + 1000 }, policy });
    expect(candidates).toEqual(['b/two', 'c/three', 'a/one']);
  });

  it('still returns everything when the whole list is cooling', () => {
    const cooldowns = { 'a/one': NOW + 1, 'b/two': NOW + 1, 'c/three': NOW + 1 };
    expect(nextCandidates({ ...base, cooldowns, policy })).toHaveLength(3);
  });

  it('ignores a cooldown that has expired', () => {
    expect(nextCandidates({ ...base, cooldowns: { 'a/one': NOW - 1 }, policy })[0]).toBe('a/one');
  });
});

describe('free-pool', () => {
  const policy: ModelPolicy = { kind: 'free-pool', minContext: 32_000 };

  it('offers only free models with enough context', () => {
    const candidates = nextCandidates({ ...base, policy });
    expect(candidates).toContain('free/big');
    expect(candidates).toContain('free/other');
    expect(candidates).not.toContain('paid/one');
    expect(candidates).not.toContain('free/small');
  });

  it('puts the healthiest model first', () => {
    const candidates = nextCandidates({
      ...base,
      policy,
      health: { 'free/big': 20, 'free/other': 99 },
    });
    expect(candidates[0]).toBe('free/other');
  });

  it('ranks an unmeasured model above one known to be struggling', () => {
    const candidates = nextCandidates({ ...base, policy, health: { 'free/big': 5 } });
    expect(candidates[0]).toBe('free/other');
  });

  it('skips a model that just failed', () => {
    const candidates = nextCandidates({ ...base, policy, cooldowns: { 'free/big': NOW + 1000 } });
    expect(candidates[0]).toBe('free/other');
  });

  it('caps how many are offered', () => {
    expect(nextCandidates({ ...base, policy }, 1)).toHaveLength(1);
  });

  it('returns nothing when the catalogue has no free model big enough', () => {
    expect(nextCandidates({ ...base, catalogue: [model('free/tiny', { contextLength: 1000 })], policy })).toEqual([]);
  });
});

describe('cooldowns', () => {
  it('parks a model for the cooldown window', () => {
    expect(withCooldown({}, 'a/one', NOW)['a/one']).toBe(NOW + COOLDOWN_MS);
  });

  it('drops entries that have expired', () => {
    expect(pruneCooldowns({ old: NOW - 1, live: NOW + 1000 }, NOW)).toEqual({ live: NOW + 1000 });
  });
});

describe('policyFromLegacy', () => {
  it('reads a lone model as a single policy', () => {
    expect(policyFromLegacy('a/one', '')).toEqual({ kind: 'single', model: 'a/one' });
  });

  it('folds old fallbacks into an ordered list', () => {
    expect(policyFromLegacy('a/one', 'b/two, c/three')).toEqual({
      kind: 'list',
      models: ['a/one', 'b/two', 'c/three'],
    });
  });
});
