import { runPrompt } from './llm-client';
import type { LlmSettings } from './settings';
import type { Source } from './bank-generation';

/**
 * Asking the user for the one thing a model cannot supply.
 *
 * Everything else in this feature can be fixed by better generation: repeated
 * verbs, weak openers, clichés. A missing number cannot. If the source says
 * "Built a RAG system over PDFs", no amount of rephrasing produces "over 500
 * documents, cutting lookup from minutes to seconds" — that fact exists only in
 * the user's head.
 *
 * So the model's job here is not to write the bullet. It is to ask a good
 * question, once, about work the user actually did. Their answer is then a
 * fact, supplied by them, and generation can use it like any other.
 *
 * Six questions at bank time, not six per application.
 */

export interface EnrichmentQuestion {
  sourceId: string;
  label: string;
  question: string;
}

const PROMPT_HEADER = [
  'A candidate wrote the achievements below, and none of them carry a measurable outcome.',
  '',
  'Ask ONE short question that would get a number out of them — a count, a duration, a percentage, a size.',
  '',
  'RULES:',
  '1. Ask about what they actually described. Never ask about work that is not there.',
  '2. One sentence. Concrete. Offer an example of the kind of answer you mean.',
  '3. Never suggest a number yourself, and never imply what the answer should be.',
  '4. Return only the question, with no preamble or quotation marks.',
  '',
].join('\n');

export function buildEnrichmentPrompt(source: Source): string {
  return [PROMPT_HEADER, `WORK — ${source.label}`, source.facts].join('\n');
}

/**
 * A question worth asking, per source item with no metric.
 *
 * A model failure here is not worth failing the run over: a generic fallback
 * question is still better than no prompt at all.
 */
export async function askForMetrics(
  sources: Source[],
  llm: LlmSettings
): Promise<EnrichmentQuestion[]> {
  const questions: EnrichmentQuestion[] = [];

  for (const source of sources) {
    let question = fallbackQuestion(source);
    try {
      const asked = (await runPrompt(buildEnrichmentPrompt(source), llm)).trim();
      // A model that returns a paragraph has not understood; the fallback is
      // better than a wall of text next to an input box.
      if (asked && asked.length < 240) question = stripQuotes(asked);
    } catch {
      // Keep the fallback.
    }
    questions.push({ sourceId: source.id, label: source.label, question });
  }

  return questions;
}

function stripQuotes(text: string): string {
  return text.replace(/^["'`]+|["'`]+$/g, '').trim();
}

/** Used when no model is configured, or when one fails. */
export function fallbackQuestion(source: Source): string {
  return `How big or how much faster was ${source.label}? A count, a percentage, or a before-and-after is enough.`;
}

/**
 * Folds an answer back into the source's facts, as the user's own words.
 *
 * Appended rather than rewritten: their sentence is the fact, and the next
 * generation run reframes it like anything else they wrote.
 */
export function applyAnswer(facts: string, answer: string): string {
  const trimmed = answer.trim();
  if (!trimmed) return facts;
  return [facts, trimmed].filter(Boolean).join('\n');
}
