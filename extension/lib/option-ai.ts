import { runPrompt } from './llm-client';
import { normalizeText } from './field-matcher';
import { matchesBooleanAnswer } from './option-synonyms';
import type { LlmSettings } from './settings';

/**
 * Option text comes from the page, and it goes into a prompt next to our own
 * instructions. A hostile posting can pad an option with its own "SYSTEM:"
 * paragraph, or hide direction in zero-width and bidi characters. Neither can
 * be reasoned away in the prompt, so the text is flattened and capped first.
 */
const MAX_OPTION_LENGTH = 200;

function sanitizeForPrompt(text: string): string {
  return text
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_OPTION_LENGTH);
}

/**
 * Whether the saved answer is a yes/no one, in which case the model must not be
 * able to flip it. This is the check the prompt only *asks* for.
 */
function booleanValue(value: string): boolean | null {
  const normalized = normalizeText(value);
  if (matchesBooleanAnswer(normalized, true)) return true;
  if (matchesBooleanAnswer(normalized, false)) return false;
  return null;
}

/**
 * Last resort for a dropdown whose wording nothing deterministic matched.
 * Kept deliberately narrow: the model only picks from options the form itself
 * offered, and only after exact, word-set and synonym matching have all
 * failed, so a normal form costs nothing.
 */
export async function chooseOptionWithAi(
  question: string,
  options: string[],
  value: string,
  llm: LlmSettings
): Promise<number> {
  if (!llm.backend || !options.length || !value.trim()) return -1;

  const numbered = options.map((option, i) => `${i}: ${sanitizeForPrompt(option)}`).join('\n');
  const prompt = [
    'A job application form is asking a question with a fixed list of options.',
    "Pick the option that matches the candidate's saved answer.",
    'Reply with the option number alone. If none of them genuinely match, reply exactly: none',
    'Never pick an option that would state something different from the saved answer.',
    '',
    `QUESTION: ${question}`,
    `SAVED ANSWER: ${value}`,
    '',
    'OPTIONS:',
    numbered,
  ].join('\n');

  try {
    const reply = (await runPrompt(prompt, llm)).trim().toLowerCase();
    if (reply.startsWith('none')) return -1;

    // Models pad answers ("Option 2." / "2 — Permanent resident"), so read the
    // first number rather than requiring a bare one.
    const match = reply.match(/\d+/);
    if (!match) return -1;

    const index = Number(match[0]);
    // A hallucinated index must not silently become a wrong selection.
    if (!Number.isInteger(index) || index < 0 || index >= options.length) return -1;

    // "Never state something different from the saved answer" is enforced here
    // rather than in the prompt: on a yes/no question the chosen option must
    // not mean the opposite of what the user saved. A prompt cannot be relied
    // on for that when the option text is written by the same party that wants
    // it flipped.
    const wanted = booleanValue(value);
    if (wanted !== null) {
      const chosen = normalizeText(options[index] ?? '');
      if (matchesBooleanAnswer(chosen, !wanted)) return -1;
    }

    return index;
  } catch {
    // The dropdown simply stays unfilled; a model outage is not worth
    // failing the whole page fill over.
    return -1;
  }
}
