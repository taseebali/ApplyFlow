import { describe, expect, it } from 'vitest';
import { ANGLES } from './bullet-bank';
import { anglesForFamily, buildFamiliesPrompt, DEFAULT_ANGLES, parseFamilies } from './target-families';
import { EMPTY_PROFILE } from './schema';

describe('parseFamilies', () => {
  const GOOD = JSON.stringify({
    families: [
      { name: 'Backend Engineer', angles: ['technical', 'scale'] },
      { name: 'Applied ML', angles: ['impact'] },
    ],
  });

  it('reads well-formed JSON', () => {
    const families = parseFamilies(GOOD);
    expect(families.map((f) => f.name)).toEqual(['Backend Engineer', 'Applied ML']);
  });

  it('completes a partial angle list rather than leaving gaps', () => {
    // A family the model only ranked two angles for still needs an order for
    // the rest, or selection has nothing to fall back on.
    const [backend] = parseFamilies(GOOD);
    expect(backend!.angles).toHaveLength(ANGLES.length);
    expect(backend!.angles.slice(0, 2)).toEqual(['technical', 'scale']);
  });

  it('recovers JSON from markdown fences and surrounding prose', () => {
    expect(parseFamilies('Sure:\n```json\n' + GOOD + '\n```\nHope that helps.')).toHaveLength(2);
  });

  it('degrades to no families rather than throwing on unusable output', () => {
    // No families is a working outcome: the bank generates with no domain
    // hints, which is the design without the refinement.
    expect(parseFamilies('I cannot help with that.')).toEqual([]);
    expect(parseFamilies('{ broken json')).toEqual([]);
    expect(parseFamilies(JSON.stringify({ families: 'nope' }))).toEqual([]);
  });

  it('drops an entry with no name', () => {
    expect(parseFamilies(JSON.stringify({ families: [{ angles: ['impact'] }] }))).toEqual([]);
  });

  it('ignores angles it does not recognise', () => {
    const [family] = parseFamilies(JSON.stringify({ families: [{ name: 'X', angles: ['nonsense', 'impact'] }] }));
    expect(family!.angles).not.toContain('nonsense');
    expect(family!.angles[0]).toBe('impact');
  });

  it('caps the list, so one runaway answer cannot balloon the bank', () => {
    const many = { families: Array.from({ length: 12 }, (_, i) => ({ name: `Family ${i}`, angles: [] })) };
    expect(parseFamilies(JSON.stringify(many))).toHaveLength(4);
  });
});

describe('anglesForFamily', () => {
  const families = [{ name: 'Frontend', angles: ['collaboration' as const, ...ANGLES.filter((a) => a !== 'collaboration')] }];

  it('uses the family’s own order when it is known', () => {
    expect(anglesForFamily(families, 'Frontend')[0]).toBe('collaboration');
  });

  it('matches a family name regardless of case', () => {
    expect(anglesForFamily(families, 'frontend')[0]).toBe('collaboration');
  });

  it('falls back for a family it has never seen, rather than returning nothing', () => {
    // The whole point of angles over titles: an unknown posting is still served.
    expect(anglesForFamily(families, 'Site Reliability')).toEqual(DEFAULT_ANGLES);
    expect(anglesForFamily(families, null)).toEqual(DEFAULT_ANGLES);
  });
});

describe('buildFamiliesPrompt', () => {
  it('asks for evidence-based families only', () => {
    const prompt = buildFamiliesPrompt(EMPTY_PROFILE);
    expect(prompt).toMatch(/do not suggest a direction the profile shows no evidence for/i);
  });

  it('names every angle it wants ranked', () => {
    const prompt = buildFamiliesPrompt(EMPTY_PROFILE);
    for (const angle of ANGLES) expect(prompt).toContain(angle);
  });

  it('says "(none)" rather than leaving a section blank for an empty profile', () => {
    expect(buildFamiliesPrompt(EMPTY_PROFILE)).toContain('(none)');
  });
});
