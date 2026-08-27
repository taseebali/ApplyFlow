import { describe, expect, it } from 'vitest';
import { normalizeQuestion } from './question-matching';

/** Two questions are treated as the same question iff their normalized forms are equal. */
const matches = (a: string, b: string) => normalizeQuestion(a) === normalizeQuestion(b);

describe('normalizeQuestion', () => {
  it('ignores case differences', () => {
    expect(matches('Why do you want to work here?', 'WHY DO YOU WANT TO WORK HERE?')).toBe(true);
    expect(matches('why do you want to work here?', 'Why Do You Want To Work Here?')).toBe(true);
  });

  it('ignores leading, trailing, and repeated internal whitespace', () => {
    expect(matches('  Why do you want to work here?  ', 'Why do you want to work here?')).toBe(true);
    expect(matches('Why do  you   want to work here?', 'Why do you want to work here?')).toBe(true);
  });

  it('treats newlines and tabs as ordinary whitespace', () => {
    expect(matches('Why do you\nwant to\twork here?', 'Why do you want to work here?')).toBe(true);
  });

  it('ignores trailing punctuation, including none at all', () => {
    expect(matches('Tell us about yourself?', 'Tell us about yourself')).toBe(true);
    expect(matches('Tell us about yourself.', 'Tell us about yourself')).toBe(true);
    expect(matches('Tell us about yourself!', 'Tell us about yourself')).toBe(true);
    expect(matches('Tell us about yourself:', 'Tell us about yourself')).toBe(true);
    expect(matches('Tell us about yourself;', 'Tell us about yourself')).toBe(true);
    expect(matches('Tell us about yourself?!', 'Tell us about yourself')).toBe(true);
  });

  it('combines casing, whitespace, and punctuation differences', () => {
    expect(matches('  WHY   do you want\tto work HERE?? ', 'Why do you want to work here')).toBe(true);
  });

  it('does not match genuinely different questions', () => {
    expect(matches('Why do you want to work here?', 'Why do you want to leave your current role?')).toBe(false);
    expect(matches('Describe a conflict you resolved.', 'Describe a project you are proud of.')).toBe(false);
  });

  it('does not let a prefix match a longer question', () => {
    expect(matches('Why do you want to work here?', 'Why do you want to work here rather than a larger company?')).toBe(
      false
    );
  });

  it('does not let a substring match its containing question', () => {
    expect(matches('work here', 'Why do you want to work here?')).toBe(false);
  });

  it('keeps punctuation that is not at the end significant', () => {
    expect(matches('Do you have a portfolio? If so, link it.', 'Do you have a portfolio If so, link it')).toBe(false);
  });

  it('normalizes the empty and whitespace-only cases to the same value', () => {
    expect(normalizeQuestion('')).toBe('');
    expect(normalizeQuestion('   \n\t ')).toBe('');
  });
});
