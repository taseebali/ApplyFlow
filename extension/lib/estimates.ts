/**
 * Figures the model worked out rather than read.
 *
 * The bank was built on one rule: facts come from the user, phrasing comes
 * from the model, and a missing number is asked for rather than invented. That
 * is the safe rule, and it is why seven items on a real profile reported
 * "nothing measurable" and produced flat bullets.
 *
 * Estimating is now allowed, and the honesty is moved rather than dropped: the
 * model must declare every figure it did not find in the source, and any number
 * it fails to declare is treated as invention and rejected. What the user sees
 * is which figures are estimates, before the resume goes anywhere — an invented
 * number is one you have to defend in an interview, and the only version of
 * this that is safe is the one where you know which they are.
 */

/**
 * Numbers as a resume writes them: 40%, 8-9, 0.7, 1,200, 3x, 12k.
 *
 * Deliberately ignores years and other bare four-digit numbers — a date in a
 * bullet is not a claimed metric, and treating "2024" as one would flag every
 * bullet that mentions when something happened.
 */
export function numbersIn(text: string): string[] {
  const found = text.match(/\d[\d,._]*\s*(?:%|k\b|m\b|x\b|fps\b|gb\b|mb\b|ms\b)?/gi) ?? [];
  return found
    .map((match) => match.replace(/\s+/g, '').toLowerCase())
    .filter((match) => !/^(19|20)\d\d$/.test(match));
}

/** Normalised so "8-9 FPS" in the text matches "8-9 fps" in the declaration. */
function key(value: string): string {
  return value.replace(/[\s,]/g, '').toLowerCase();
}

/**
 * Numbers in the bullet that are neither in the source nor declared as
 * estimates. Each of these is a figure nobody takes responsibility for, which
 * is the one thing this must not produce.
 */
export function undeclaredNumbers(text: string, source: string, declared: string[]): string[] {
  const known = new Set([...numbersIn(source).map(key), ...declared.flatMap((d) => numbersIn(d)).map(key)]);
  return numbersIn(text).filter((number) => !known.has(key(number)));
}

/** Estimates the model declared that do not actually appear in the bullet. */
export function danglingEstimates(text: string, declared: string[]): string[] {
  const inText = new Set(numbersIn(text).map(key));
  return declared.filter((estimate) => !numbersIn(estimate).map(key).some((n) => inText.has(n)));
}
