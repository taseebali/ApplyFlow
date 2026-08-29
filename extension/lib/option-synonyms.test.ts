import { describe, expect, it } from 'vitest';
import { meansTheSame, synonymsFor } from './option-synonyms';

describe('meansTheSame', () => {
  it('treats sentence forms of yes/no as the plain word', () => {
    expect(meansTheSame('Yes', 'I am')).toBe(true);
    expect(meansTheSame('No', 'I do not')).toBe(true);
  });

  it('does not confuse yes with no', () => {
    expect(meansTheSame('Yes', 'No')).toBe(false);
    expect(meansTheSame('authorised', 'not authorised')).toBe(false);
  });

  it('matches availability wordings', () => {
    expect(meansTheSame('Immediately', 'Available right away')).toBe(false);
    expect(meansTheSame('Immediately', 'right away')).toBe(true);
    expect(meansTheSame('Available Immediately', 'Immediately Available')).toBe(true);
  });

  it('matches work authorisation wordings', () => {
    expect(meansTheSame('EU citizen', 'EU national')).toBe(true);
    expect(meansTheSame('Requires sponsorship', 'Sponsorship required')).toBe(true);
    expect(meansTheSame('EU citizen', 'Requires sponsorship')).toBe(false);
  });

  it('matches language levels across CEFR and prose', () => {
    expect(meansTheSame('C1', 'Advanced')).toBe(true);
    expect(meansTheSame('Native', 'C2')).toBe(true);
    expect(meansTheSame('C1', 'B1')).toBe(false);
  });

  it('ignores case and punctuation', () => {
    expect(meansTheSame('YES.', 'yes')).toBe(true);
  });

  it('is false for unrelated text rather than guessing', () => {
    expect(meansTheSame('Bachelor of Science', 'EU citizen')).toBe(false);
  });
});

describe('synonymsFor', () => {
  it('returns the whole group for a known wording', () => {
    expect(synonymsFor('Immediately')).toContain('available immediately');
  });

  it('returns just the value itself when it is not in any group', () => {
    expect(synonymsFor('Bachelor of Science')).toEqual(['bachelor of science']);
  });

  it('returns nothing for empty input', () => {
    expect(synonymsFor('')).toEqual([]);
  });
});
