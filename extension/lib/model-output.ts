/**
 * What a model returned, before anyone believes it is an answer.
 *
 * Small models — and the free tiers of large ones — routinely answer a prompt
 * by working through it out loud. Asked for one line of summary, one came back
 * with "1. **Analyze the Request:** - User wants a summary line...". Asked how
 * many hours a week the candidate could work, another returned nine hundred
 * words of "Let's re-read Rule 5" and ran out of tokens mid-sentence, never
 * reaching an answer at all. Both went straight into the UI, and the second
 * would have gone onto a job application.
 *
 * This was fixed once, in `cleanSummary`, for summaries only. Every other
 * caller of the model — drafted answers, cover letters, enrichment questions —
 * had the same hole, because the fault is the model's, not the summary
 * prompt's. So the guard lives here, at the one place every request already
 * funnels through, and the callers that expect prose add a refusal on top.
 *
 * Two jobs, deliberately separate:
 *
 * - `stripReasoning` removes a reasoning block that sits *around* a real
 *   answer. Safe for every caller, including the ones parsing JSON, because
 *   nothing legitimate contains a `<think>` tag — and a model that emits one
 *   before valid JSON currently breaks the parser too.
 * - `asProse` refuses output that is reasoning *instead of* an answer. Only
 *   for callers that expect a sentence, since a numbered list is a perfectly
 *   good reply to "rank these bullets".
 */

/**
 * Reasoning the model marked as such.
 *
 * The unterminated case matters more than the paired one: a model that opens
 * `<think>` and hits the token ceiling never closes it, which is exactly the
 * run that produces no answer.
 */
const TAGS = ['think', 'thinking', 'reasoning', 'scratchpad', 'analysis'];

/**
 * Openers a model uses when it narrates its own process in plain text.
 *
 * Matched only at the very start, and only followed by a colon or a newline,
 * so an answer that happens to contain the word "thinking" is left alone.
 */
const PREAMBLE =
  /^\s*(here(?:'s| is| are)?(?: the| my| a)?\s+)?(thinking process|thought process|chain of thought|reasoning|my thinking|let me think(?: this through| about this)?)\s*[:.]?\s*/i;

/**
 * Shapes that mean the text is the model's working rather than its answer.
 *
 * Each was observed in output that reached the UI. Markdown bold is on the
 * list because every prompt in the extension asks for plain text, so `**` is
 * never something we asked for.
 */
const REASONING = [
  /\*\*/,
  /^\s*\d+\.\s/, // a numbered analysis
  /\buser (wants|asks|is asking|needs)\b/i,
  /\brules?:/i,
  /\b(analyz|analys)e the (request|prompt|task|user)\b/i,
  /\bstep \d\b/i,
  /\blet me (re-?read|think|check|analyz|analys)/i,
  /\bconstraints?:/i,
  /\bi (need to|should|must) (output|answer|write|return)\b/i,
];

export function looksLikeReasoning(text: string): boolean {
  return REASONING.some((pattern) => pattern.test(text));
}

/**
 * Removes a reasoning block, leaving whatever answer followed it.
 *
 * Safe to run on every completion: it only removes text the model itself
 * marked as thinking, or a narration opener no prompt here ever asks for.
 */
export function stripReasoning(raw: string): string {
  let text = raw;

  for (const tag of TAGS) {
    // Paired first, then an opener with no close — everything after an
    // unterminated `<think>` is reasoning by definition.
    // `\b` after the name, because `think` is a prefix of `thinking`: without
    // it, `<think[^>]*>` matched a `<thinking>` opener whose `</thinking>`
    // close it could not match, and the unterminated rule below then ate the
    // answer that followed.
    text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\b[^>]*>`, 'gi'), '');
    text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'i'), '');
  }

  return text.replace(PREAMBLE, '').trim();
}

/** The model returned its working instead of an answer. */
export class ModelReasoned extends Error {}

const REASONED_MESSAGE =
  'The model returned its own working instead of an answer. Smaller free models often do this — try again, or pick a different model under Settings → AI.';

/**
 * A completion a caller can put in front of the user as prose.
 *
 * Throws rather than returning something shortened: there is no answer inside
 * a page of deliberation to recover, and a truncated version of it on a job
 * application is worse than a visible failure.
 */
export function asProse(raw: string): string {
  const text = stripReasoning(raw);
  if (!text) throw new ModelReasoned('The model returned nothing.');
  if (looksLikeReasoning(text)) throw new ModelReasoned(REASONED_MESSAGE);
  return text;
}
