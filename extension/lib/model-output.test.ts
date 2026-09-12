import { describe, expect, it } from 'vitest';
import { asProse, looksLikeReasoning, ModelReasoned, stripReasoning } from './model-output';

/**
 * Verbatim, from a drafted answer that reached the panel. The question was
 * "How many hours could you work during the week?" and the model spent its
 * entire budget deliberating, running out of tokens mid-sentence without ever
 * answering. This is the shape the guard exists for.
 */
const THINKING_OUT_LOUD = `Here's a thinking process:

1.  **Analyze the User's Request:**
   - I need to draft one answer to one question on a job application.
   - Rules: Answer the question directly in the first sentence.

2.  **Examine the Constraints (Rules):**
   - Rule 5: Do not volunteer a shortfall. Let me re-read Rule 5.
   - Wait, maybe the answer is simply "0" because WORK HISTORY is (none provided), but that's a stretch and`;

describe('stripReasoning', () => {
  it('removes a reasoning block and keeps the answer after it', () => {
    expect(stripReasoning('<think>The candidate is a student.</think>Up to 20 hours a week.')).toBe(
      'Up to 20 hours a week.'
    );
  });

  it('removes an unterminated block, which is what a truncated run leaves', () => {
    // The run that hits the token ceiling never closes the tag, and everything
    // after the opener is reasoning by definition.
    expect(stripReasoning('<think>Let me work through the rules one by one')).toBe('');
  });

  it('removes the narration opener a model writes without any tags', () => {
    expect(stripReasoning("Here's my thinking process: Up to 20 hours a week.")).toBe(
      'Up to 20 hours a week.'
    );
  });

  it('leaves an ordinary answer alone', () => {
    const answer = 'Up to 20 hours a week, around my lectures.';
    expect(stripReasoning(answer)).toBe(answer);
  });

  it('does not eat an answer that happens to mention thinking', () => {
    const answer = 'I enjoy thinking through a problem before writing code.';
    expect(stripReasoning(answer)).toBe(answer);
  });

  it('leaves JSON untouched, so the parsers are unaffected', () => {
    expect(stripReasoning('{"skills":["Python"]}')).toBe('{"skills":["Python"]}');
  });

  it('clears a reasoning block sitting in front of JSON', () => {
    // The same fault breaks a parser as surely as it confuses a reader.
    expect(stripReasoning('<thinking>listing skills</thinking>\n{"skills":["Python"]}')).toBe(
      '{"skills":["Python"]}'
    );
  });
});

describe('looksLikeReasoning', () => {
  it('recognises the answer that shipped', () => {
    expect(looksLikeReasoning(THINKING_OUT_LOUD)).toBe(true);
  });

  it.each([
    'Up to 20 hours a week.',
    'Yes.',
    '15 September 2026.',
    'I built a retrieval pipeline for 40,000 documents.',
    'I am available from 1 October and can work Mondays through Wednesdays.',
  ])('leaves a real answer alone: %s', (answer) => {
    expect(looksLikeReasoning(answer)).toBe(false);
  });
});

describe('asProse', () => {
  it('refuses the drafted answer that was deliberation all the way down', () => {
    expect(() => asProse(THINKING_OUT_LOUD)).toThrow(ModelReasoned);
  });

  it('says what to do about it rather than just failing', () => {
    // "Could not draft an answer" sends someone checking their API key. This
    // is a small-model behaviour and the message should say so.
    expect(() => asProse(THINKING_OUT_LOUD)).toThrow(/free models often do this|different model/i);
  });

  it('refuses an empty answer', () => {
    expect(() => asProse('   ')).toThrow(ModelReasoned);
  });

  it('refuses output that is nothing but an unterminated reasoning block', () => {
    expect(() => asProse('<think>Let me re-read the rules')).toThrow(ModelReasoned);
  });

  it('returns the answer that followed the reasoning', () => {
    expect(asProse('<think>student, so limited hours</think>\nUp to 20 hours a week.')).toBe(
      'Up to 20 hours a week.'
    );
  });

  it('returns a plain answer unchanged', () => {
    expect(asProse('Up to 20 hours a week.')).toBe('Up to 20 hours a week.');
  });
});
