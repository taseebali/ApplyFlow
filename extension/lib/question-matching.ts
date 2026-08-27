/**
 * Normalizes a question for exact-after-normalization comparison: lowercase,
 * collapse internal whitespace, trim, and strip trailing punctuation.
 *
 * This is the guard that decides whether a saved answer may be reused for a
 * question on a real job application, so it deliberately only absorbs cosmetic
 * differences (casing, spacing, a trailing "?"). It must never make two
 * genuinely different questions compare equal — a loose prefix or substring
 * match would silently put the wrong answer into someone's application.
 */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!:;]+$/, '');
}
