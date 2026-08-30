import { describe, expect, it } from 'vitest';
import { findSimilarAnswer, questionSimilarity } from './question-matching';
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

describe('reusing a saved answer for a reworded question', () => {
  const saved = [
    { question: 'Why do you want to work at this company?', answer: 'Because…' },
    { question: 'Describe your experience with Python and Django', answer: 'I have…' },
  ];

  it('recognises the same question worded differently', () => {
    const found = findSimilarAnswer('Why would you like to work for our company?', saved);
    expect(found?.entry.answer).toBe('Because…');
  });

  it('does not match a genuinely different question', () => {
    expect(findSimilarAnswer('What is your notice period?', saved)).toBeNull();
  });

  it('does not confuse two questions that merely share filler words', () => {
    // Both are "describe your experience with X" — the X is what matters, and
    // "experience"/"describe" alone must not be enough.
    const found = findSimilarAnswer('Describe your availability and notice period', saved);
    expect(found).toBeNull();
  });

  it('offers rather than applies — the caller shows both questions', () => {
    const found = findSimilarAnswer('Why would you like to work for our company?', saved);
    expect(found!.similarity).toBeLessThan(1);
  });

  it('scores an identical question as fully similar', () => {
    expect(questionSimilarity('Why do you want to work here?', 'why do you want to work here')).toBe(1);
  });

  it('ignores an empty or filler-only question rather than matching everything', () => {
    expect(questionSimilarity('Why do you?', 'What about us?')).toBe(0);
  });
});
