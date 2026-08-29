import type { Profile } from './schema';
import type { LlmSettings } from './settings';

export interface DraftContext {
  question: string;
  jobDescription: string | null;
  profile: Profile;
}

export class LlmError extends Error {}

/**
 * A local model on a busy machine can take a while, but never minutes. A cap
 * means a stalled backend surfaces as a clear failure instead of a spinner
 * that never resolves.
 */
const REQUEST_TIMEOUT_MS = 90_000;

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

/**
 * A personal project directory is small (a handful of entries), so the whole
 * of it goes into the prompt directly — no retrieval or embedding step.
 */
export function buildPrompt(context: DraftContext): string {
  const { question, jobDescription, profile } = context;

  const work = profile.workHistory
    .map((w) => `- ${w.title} at ${w.company} (${w.startDate}–${w.current ? 'present' : w.endDate}): ${w.description}`)
    .join('\n');

  const projects = profile.projects
    .map((p) => `- ${p.name} (${p.role}) — ${p.description}. Tech: ${p.techStack}. Outcome: ${p.outcomes}`)
    .join('\n');

  // Education and languages were missing, which is why a question about
  // studies or language level had nothing to draw on.
  const education = profile.education
    .map(
      (e) =>
        `- ${e.degree} in ${e.fieldOfStudy || 'n/a'}, ${e.school} (${e.startDate}–${
          e.current ? `${e.endDate} expected` : e.endDate
        })`
    )
    .join('\n');

  const languages = profile.languages.map((l) => `- ${l.language}: ${l.level}`).join('\n');

  const location = [profile.contact.city, profile.contact.country].filter(Boolean).join(', ');

  return [
    'You are helping a candidate answer a job application question in their own voice.',
    'Write a concise, specific, first-person answer. Use only the facts given below — never invent experience, employers, dates, or metrics.',
    'Return only the answer text, with no preamble, quotes, or commentary.',
    '',
    `QUESTION: ${question}`,
    '',
    'JOB DESCRIPTION:',
    jobDescription || '(not available)',
    '',
    'CANDIDATE WORK HISTORY:',
    work || '(none provided)',
    '',
    'CANDIDATE PROJECTS:',
    projects || '(none provided)',
    '',
    'CANDIDATE EDUCATION:',
    education || '(none provided)',
    '',
    'CANDIDATE LANGUAGES:',
    languages || '(none provided)',
    '',
    `CANDIDATE LOCATION: ${location || '(not provided)'}`,
  ].join('\n');
}

async function runWithOllama(prompt: string, llm: LlmSettings): Promise<string> {
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: llm.ollamaModel, prompt, stream: false }),
    signal: timeoutSignal(),
  });
  if (!response.ok) {
    throw new LlmError(
      `Ollama returned ${response.status}. Is Ollama running, and is the model "${llm.ollamaModel}" pulled?`
    );
  }
  const data = (await response.json()) as { response?: string };
  return (data.response ?? '').trim();
}

async function runWithOpenRouter(prompt: string, llm: LlmSettings): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${llm.openRouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: llm.openRouterModel,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: timeoutSignal(),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new LlmError(`OpenRouter returned ${response.status}: ${body.slice(0, 200)}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

/**
 * Sends a prompt to whichever backend the user configured and returns the raw
 * text. Every LLM feature goes through here so the fetch and error handling
 * live in exactly one place.
 */
export async function runPrompt(prompt: string, llm: LlmSettings): Promise<string> {
  try {
    if (llm.backend === 'ollama') return await runWithOllama(prompt, llm);
    if (llm.backend === 'openrouter') return await runWithOpenRouter(prompt, llm);
  } catch (err) {
    if (err instanceof LlmError) throw err;
    // An aborted request reads as a cryptic DOMException otherwise.
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new LlmError(`The model did not answer within ${REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    throw new LlmError(
      llm.backend === 'ollama'
        ? 'Could not reach Ollama on localhost:11434. Is it running?'
        : 'Could not reach OpenRouter. Check your connection and API key.'
    );
  }
  throw new LlmError('No AI backend is set up yet. Open Settings to choose one.');
}

export async function draftAnswer(context: DraftContext, llm: LlmSettings): Promise<string> {
  return runPrompt(buildPrompt(context), llm);
}
