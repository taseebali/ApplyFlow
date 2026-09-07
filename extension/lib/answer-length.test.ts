import { describe, expect, it } from 'vitest';
import { lengthForQuestion, lengthRuleFor } from './answer-length';

describe('lengthForQuestion', () => {
  it('treats the internship-length question as short', () => {
    // The reported failure: this got the same 120-180 word budget as an essay
    // question and came back as three paragraphs.
    expect(lengthForQuestion('How long should your internship last?')).toBe('short');
  });

  it('recognises the other one-line facts a form asks for', () => {
    for (const question of [
      'When can you start?',
      'What is your notice period?',
      'Earliest possible start date',
      'How many hours per week are you available?',
      'Are you legally authorised to work in Germany?',
    ]) {
      expect(lengthForQuestion(question)).toBe('short');
    }
  });

  it('keeps a real writing prompt long', () => {
    expect(lengthForQuestion('Tell us about a time you disagreed with a teammate.')).toBe('long');
    expect(lengthForQuestion('Describe a challenge you faced and how you handled it.')).toBe('long');
  });

  it('falls through to a paragraph for anything it cannot classify', () => {
    // Guessing "short" for an essay question is the worse mistake, so anything
    // unclear gets the middle budget.
    expect(lengthForQuestion('Why do you want to work here?')).toBe('medium');
    expect(lengthForQuestion('What interests you about this role?')).toBe('medium');
  });

  it('is not fooled by "how" on its own', () => {
    expect(lengthForQuestion('How would you approach designing this system?')).toBe('medium');
  });
});

describe('lengthRuleFor', () => {
  it('lets the form’s own limit win over anything inferred', () => {
    // The form knows what it will accept; this only knows what the question
    // sounds like.
    expect(lengthRuleFor('How long should your internship last?', 2000)).toContain('2000 characters');
  });

  it('asks for one sentence when the question wants one', () => {
    expect(lengthRuleFor('When can you start?')).toMatch(/one sentence/i);
  });

  it('asks for a paragraph otherwise', () => {
    expect(lengthRuleFor('Why this company?')).toMatch(/60-120 words/);
  });
});
