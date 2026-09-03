import { describe, expect, it } from 'vitest';
import {
  ageInDays,
  contentTerms,
  makeVariant,
  missingSources,
  replaceSource,
  variantsFor,
  type BulletBank,
} from './bullet-bank';

const variant = (sourceId: string, text = 'Cut latency 40% across 3 services.') =>
  makeVariant({ sourceId, angle: 'impact', text });

const bankOf = (variants: ReturnType<typeof variant>[]): BulletBank => ({
  variants,
  generatedAt: Date.now(),
  model: 'test/model',
  families: ['Backend'],
});

describe('makeVariant', () => {
  it('derives the fields selection depends on, rather than trusting a caller', () => {
    const v = makeVariant({ sourceId: 's1', angle: 'scale', text: 'Shipped 4 services to 12k users.' });
    expect(v.openingVerb).toBe('shipped');
    expect(v.hasMetric).toBe(true);
    expect(v.terms).toContain('services');
  });

  it('notices a variant with no number in it', () => {
    expect(makeVariant({ sourceId: 's1', angle: 'impact', text: 'Improved reliability.' }).hasMetric).toBe(false);
  });

  it('trims the text before deriving anything from it', () => {
    expect(makeVariant({ sourceId: 's1', angle: 'impact', text: '  Built 2 things.  ' }).openingVerb).toBe('built');
  });

  it('defaults the domain hint to none rather than guessing one', () => {
    expect(makeVariant({ sourceId: 's1', angle: 'impact', text: 'Did 1 thing.' }).domainHint).toBeNull();
  });
});

describe('contentTerms', () => {
  it('keeps the words that carry matching signal', () => {
    const terms = contentTerms('Built a Kubernetes operator for the ingest pipeline');
    expect(terms).toContain('kubernetes');
    expect(terms).toContain('ingest');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('for');
  });

  it('keeps technology names with punctuation in them', () => {
    const terms = contentTerms('Wrote C# and Node.js services with CI/CD');
    expect(terms).toContain('node.js');
    expect(terms).toContain('c#');
  });

  it('deduplicates, so a repeated word does not outweigh the rest', () => {
    expect(contentTerms('docker docker docker').filter((t) => t === 'docker')).toHaveLength(1);
  });

  it('returns nothing for text with no content words', () => {
    expect(contentTerms('the and of it')).toEqual([]);
  });
});

describe('variantsFor and replaceSource', () => {
  it('finds only the variants belonging to one source', () => {
    const bank = bankOf([variant('a'), variant('b'), variant('a')]);
    expect(variantsFor(bank, 'a')).toHaveLength(2);
  });

  it('replaces one source without touching the others', () => {
    // Regenerating one project must not cost the rest of the bank.
    const bank = bankOf([variant('a'), variant('b')]);
    const next = replaceSource(bank, 'a', [variant('a'), variant('a')]);

    expect(variantsFor(next, 'a')).toHaveLength(2);
    expect(variantsFor(next, 'b')).toHaveLength(1);
  });

  it('is safe on a bank with no such source', () => {
    const bank = bankOf([variant('a')]);
    expect(replaceSource(bank, 'unknown', []).variants).toHaveLength(1);
  });

  it('returns nothing for a bank that does not exist yet', () => {
    expect(variantsFor(null, 'a')).toEqual([]);
  });
});

describe('staleness', () => {
  it('reports the bank’s age in days', () => {
    const now = Date.now();
    const bank = { ...bankOf([]), generatedAt: now - 3 * 86_400_000 };
    expect(ageInDays(bank, now)).toBe(3);
  });

  it('names sources the bank has never seen', () => {
    // A new role is invisible to tailoring until the bank knows about it, and
    // nothing else would say so.
    const bank = bankOf([variant('a')]);
    expect(missingSources(bank, ['a', 'b', 'c'])).toEqual(['b', 'c']);
  });

  it('treats every source as missing when there is no bank', () => {
    expect(missingSources(null, ['a', 'b'])).toEqual(['a', 'b']);
  });
});
