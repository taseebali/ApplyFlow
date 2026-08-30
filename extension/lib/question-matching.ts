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

/** Content words, with the filler that varies between employers dropped. */
const NOISE = new Set([
  'a', 'an', 'the', 'is', 'are', 'do', 'does', 'did', 'you', 'your', 'yours', 'us', 'we', 'our',
  'to', 'of', 'in', 'on', 'for', 'at', 'and', 'or', 'this', 'that', 'it', 'be', 'why', 'what',
  'how', 'would', 'will', 'can', 'could', 'please', 'tell', 'about', 'me', 'here', 'role',
  'position', 'company', 'job',
]);

function contentWords(question: string): Set<string> {
  return new Set(
    normalizeQuestion(question)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !NOISE.has(word))
  );
}

/**
 * How alike two questions are, 0 to 1, by shared content words.
 *
 * Employers ask the same handful of questions in slightly different words, and
 * exact matching meant paying for a model call every time the wording moved.
 * This is a *suggestion* only — the threshold is high, and reuse is offered to
 * the user rather than applied, because putting a nearly-right answer into a
 * real application unasked is worse than drafting a new one.
 */
export function questionSimilarity(a: string, b: string): number {
  const left = contentWords(a);
  const right = contentWords(b);
  if (left.size === 0 || right.size === 0) return 0;

  const shared = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return shared / union;
}

/**
 * Low enough to catch a genuine rewording — "why do you want to work at this
 * company" against "why would you like to work for our company" share only
 * "work" once filler is stripped, so a strict threshold catches nothing.
 *
 * Safe at this level *only* because a match is never applied automatically:
 * the user is shown both questions and chooses. Reusing an answer unasked at
 * this similarity would eventually put the wrong answer into a real
 * application.
 */
export const REUSE_THRESHOLD = 0.3;

/**
 * The closest saved answer worth *offering* for this question. Never a
 * substitute for an exact match, which is handled separately and applied
 * directly.
 */
export function findSimilarAnswer<T extends { question: string }>(
  question: string,
  saved: T[]
): { entry: T; similarity: number } | null {
  let best: { entry: T; similarity: number } | null = null;

  for (const entry of saved) {
    const similarity = questionSimilarity(question, entry.question);
    if (similarity >= REUSE_THRESHOLD && (!best || similarity > best.similarity)) {
      best = { entry, similarity };
    }
  }

  return best;
}
