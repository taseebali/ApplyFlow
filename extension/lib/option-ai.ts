import { runPrompt } from './llm-client';
import type { LlmSettings } from './settings';

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

  const numbered = options.map((option, i) => `${i}: ${option}`).join('\n');
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
    return Number.isInteger(index) && index >= 0 && index < options.length ? index : -1;
  } catch {
    // The dropdown simply stays unfilled; a model outage is not worth
    // failing the whole page fill over.
    return -1;
  }
}
