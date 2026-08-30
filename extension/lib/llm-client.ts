import type { Profile } from './schema';
import type { LlmSettings } from './settings';
import {
  describeOpenRouterFailure,
  extractOpenRouterCompletion,
  isTransientStatus,
  type Completion,
} from './openrouter-errors';
import { LlmError } from './llm-error';
import { nextCandidates } from './model-router';
import { getCooldowns, recordFailure } from './model-cooldowns';
import { getModels } from './openrouter-catalog';

export interface DraftContext {
  question: string;
  jobDescription: string | null;
  profile: Profile;
}

export { LlmError };

/**
 * The job description is scraped from the page and goes into the prompt next
 * to our instructions. Capping it means a posting padded with thousands of
 * words of its own direction cannot dominate the context by volume — and
 * keeps a runaway page from burning the user's tokens.
 */
const MAX_JOB_DESCRIPTION_CHARS = 12_000;

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
    jobDescription ? jobDescription.slice(0, MAX_JOB_DESCRIPTION_CHARS) : '(not available)',
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

async function runWithOllama(prompt: string, llm: LlmSettings): Promise<Completion> {
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
  return { text: (data.response ?? '').trim(), model: llm.ollamaModel };
}

/**
 * The models this request should try, best first. A `free-pool` policy needs
 * the catalogue to know what is currently free; the other policies name their
 * models outright, so a catalogue failure must not stop them.
 */
async function candidatesFor(llm: LlmSettings): Promise<string[]> {
  const cooldowns = await getCooldowns();
  const catalogue =
    llm.modelPolicy.kind === 'free-pool' ? await getModels().catch(() => []) : [];

  const candidates = nextCandidates({ policy: llm.modelPolicy, catalogue, cooldowns, now: Date.now() });

  if (candidates.length === 0) {
    throw new LlmError(
      llm.modelPolicy.kind === 'free-pool'
        ? 'No free model with enough context is available right now. Open Settings to pick a model directly, or lower the minimum context.'
        : 'No model is selected. Open Settings and choose one.'
    );
  }
  return candidates;
}

async function postToOpenRouter(prompt: string, llm: LlmSettings, models: string[]): Promise<Completion> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${llm.openRouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: models[0],
      // OpenRouter walks this list itself when a model errors, is rate limited,
      // or its provider is down - which is exactly how a busy free endpoint
      // fails. Our own rotation sits outside it and remembers across requests.
      ...(models.length > 1 ? { models } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: timeoutSignal(),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new LlmError(describeOpenRouterFailure(response.status, body), isTransientStatus(response.status));
  }
  const data = await response.json().catch(() => {
    // A 200 whose body will not parse is not a connection problem, and saying
    // so would send the user checking their key for no reason.
    throw new LlmError('OpenRouter returned a response that could not be read as JSON.', true);
  });
  return extractOpenRouterCompletion(data);
}

/**
 * Walks the candidate models, parking each one that fails transiently so the
 * next request - and the next question in a drafting run - starts somewhere
 * that is actually answering.
 */
async function runWithOpenRouter(prompt: string, llm: LlmSettings): Promise<Completion> {
  const candidates = await candidatesFor(llm);
  let last: unknown;

  for (let i = 0; i < candidates.length; i++) {
    // Hand OpenRouter the rest of the list too, so one request already tries
    // more than one model before coming back to us.
    const attempt = candidates.slice(i);
    try {
      return await postToOpenRouter(prompt, llm, attempt);
    } catch (err) {
      last = err;
      if (!(err instanceof LlmError) || !err.transient) throw err;
      await recordFailure(candidates[i]!);
    }
  }

  throw last;
}

/**
 * Free endpoints are shared, and a saturated one refuses for a few seconds
 * rather than for good. Two quick retries turn the most common failure of the
 * free tier into a pause instead of a dead run. Only failures classed as
 * transient are retried; a bad key fails immediately, as it should.
 */
const RETRY_DELAYS_MS = [1_000, 3_000];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runOnce(backend: 'ollama' | 'openrouter', prompt: string, llm: LlmSettings): Promise<Completion> {
  try {
    return backend === 'ollama' ? await runWithOllama(prompt, llm) : await runWithOpenRouter(prompt, llm);
  } catch (err) {
    if (err instanceof LlmError) throw err;
    // An aborted request reads as a cryptic DOMException otherwise.
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new LlmError(`${backend} did not answer within ${REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    throw new LlmError(
      backend === 'ollama'
        ? 'Could not reach Ollama on localhost:11434. Is it running?'
        : 'Could not reach OpenRouter. Check your connection and API key.',
      // A network-level failure is as likely to be a blip as a real outage.
      true
    );
  }
}

/**
 * Sends a prompt to whichever backend the user configured and returns the raw
 * text. Every LLM feature goes through here so the fetch, retries, and error
 * handling live in exactly one place.
 */
async function runWith(backend: 'ollama' | 'openrouter', prompt: string, llm: LlmSettings): Promise<Completion> {
  let last: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await runOnce(backend, prompt, llm);
    } catch (err) {
      last = err;
      const retryable = err instanceof LlmError && err.transient;
      if (!retryable || attempt === RETRY_DELAYS_MS.length) break;
      await wait(RETRY_DELAYS_MS[attempt]!);
    }
  }

  throw last;
}

/**
 * Sends a prompt to whichever backend the user configured and returns the raw
 * text. When a fallback is set it takes over if the primary fails, so a rate
 * limit, an outage, or being offline degrades to the other backend instead of
 * failing the run.
 */
export async function runPromptDetailed(prompt: string, llm: LlmSettings): Promise<Completion> {
  if (!llm.backend) throw new LlmError('No AI backend is set up yet. Open Settings to choose one.');

  try {
    return await runWith(llm.backend, prompt, llm);
  } catch (primaryError) {
    if (!llm.fallbackBackend || llm.fallbackBackend === llm.backend) throw primaryError;

    try {
      return await runWith(llm.fallbackBackend, prompt, llm);
    } catch (fallbackError) {
      // Report both, since "it failed" is not actionable when two backends
      // were tried and each stopped for its own reason.
      const primary = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const secondary = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new LlmError(`${llm.backend} failed (${primary}); ${llm.fallbackBackend} also failed (${secondary}).`);
    }
  }
}

/** The answer text alone, for the callers that do not need to know the model. */
export async function runPrompt(prompt: string, llm: LlmSettings): Promise<string> {
  return (await runPromptDetailed(prompt, llm)).text;
}

export async function draftAnswer(context: DraftContext, llm: LlmSettings): Promise<Completion> {
  return runPromptDetailed(buildPrompt(context), llm);
}

/**
 * Sends the smallest possible real request to one backend so a misconfigured
 * key, an unroutable model, or a blocked data policy can be found from Settings
 * in a second, instead of by importing a resume and reading a failure at the
 * end of it. Deliberately targets one backend rather than going through the
 * fallback chain: the point is to learn whether *this* one works.
 */
export async function testLlmConnection(
  llm: LlmSettings,
  backend: 'ollama' | 'openrouter'
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (backend === 'openrouter' && !llm.openRouterApiKey) {
    return { ok: false, message: 'Enter your OpenRouter API key first.' };
  }
  try {
    await runWith(backend, 'Reply with exactly the word: ok', llm);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'The request failed.' };
  }
}
