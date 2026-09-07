/**
 * How long an answer should be, read from the question.
 *
 * Every question without a declared `maxlength` got the same instruction —
 * "aim for 120-180 words" — so "How long should your internship last?" was
 * answered at the same length as "Why do you want to work here?". The observed
 * result was three paragraphs where "six months, from March" was the whole
 * answer.
 *
 * A declared limit still wins over anything guessed here: the form knows what
 * it will accept and this only knows what the question sounds like.
 */
export type AnswerLength = 'short' | 'medium' | 'long';

/**
 * Questions answerable with a date, a duration, a number or a yes.
 *
 * Deliberately narrow. Guessing "short" for a real essay question produces a
 * thin answer, which is worse than a long answer to a short question — so
 * anything not clearly on this list falls through to the paragraph budget.
 */
const SHORT = [
  /\bhow (long|many|much|soon)\b/i,
  /\bwhen (can|could|would|will|are|do) you\b/i,
  /\bwhat is your (notice period|availability|expected salary|salary expectation)\b/i,
  /\b(earliest|preferred|expected) (start|starting|available)\b/i,
  /\bstart date\b/i,
  /\bnotice period\b/i,
  /\bhours per week\b/i,
  /\b(duration|length) of (the )?(internship|contract|placement)\b/i,
  /\bare you (legally )?(able|eligible|authori[sz]ed|willing)\b/i,
  /\bdo you (have|hold|require|need)\b/i,
];

/** Questions that are asking for a real piece of writing. */
const LONG = [
  /\btell us about\b/i,
  /\bdescribe a (time|situation|project|challenge)\b/i,
  /\bwalk us through\b/i,
  /\bin (your|as much) (own words|detail)\b/i,
  /\bcover letter\b/i,
  /\bmotivation(al)? (letter|statement)\b/i,
];

export function lengthForQuestion(question: string): AnswerLength {
  const text = question.trim();
  if (SHORT.some((pattern) => pattern.test(text))) return 'short';
  if (LONG.some((pattern) => pattern.test(text))) return 'long';
  return 'medium';
}

const BUDGETS: Record<AnswerLength, string> = {
  short:
    'This is a short factual question. Answer it in one sentence - a date, a duration, a number, or a plain yes or no with at most a clause of context. Do not explain, do not elaborate, do not add a second sentence.',
  medium:
    'Aim for 60-120 words. Shorter is better than padded; stop when the question is answered.',
  long: 'Aim for 150-220 words, in two or three short paragraphs.',
};

/**
 * The length rule for one question. A form's declared limit is authoritative;
 * everything else is inferred from the wording.
 */
export function lengthRuleFor(question: string, maxLength?: number | null): string {
  if (maxLength) {
    return `Stay under ${maxLength} characters - the form will not accept more. Aim for about ${Math.floor(
      maxLength * 0.7
    )}.`;
  }
  return BUDGETS[lengthForQuestion(question)];
}
