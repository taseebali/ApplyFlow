import { describe, expect, it, vi } from 'vitest';
import { applyAnswer, askForMetrics, buildEnrichmentPrompt, fallbackQuestion } from './enrichment';
import type { Source } from './bank-generation';
import type { LlmSettings } from './settings';

const runPrompt = vi.hoisted(() => vi.fn());
vi.mock('./llm-client', () => ({ runPrompt }));

const source: Source = {
  id: 's1',
  label: 'Repo Triage Agent',
  facts: 'Built an agent that investigates GitHub issues end to end.',
  techStack: 'python',
};

const LLM = { backend: 'openrouter' } as unknown as LlmSettings;

describe('buildEnrichmentPrompt', () => {
  it('forbids the model suggesting a number itself', () => {
    // The whole point is to get a fact out of the user. A suggested number
    // would be an invented one wearing their name.
    expect(buildEnrichmentPrompt(source)).toMatch(/never suggest a number yourself/i);
  });

  it('forbids asking about work that is not there', () => {
    expect(buildEnrichmentPrompt(source)).toMatch(/never ask about work that is not there/i);
  });

  it('includes the work it is asking about', () => {
    expect(buildEnrichmentPrompt(source)).toContain('investigates GitHub issues');
  });
});

describe('askForMetrics', () => {
  it('uses the question the model wrote', async () => {
    runPrompt.mockResolvedValueOnce('How many issues did the agent resolve, and how accurately?');
    const [question] = await askForMetrics([source], LLM);
    expect(question!.question).toBe('How many issues did the agent resolve, and how accurately?');
    expect(question!.sourceId).toBe('s1');
  });

  it('strips quotation marks the model wrapped it in', async () => {
    runPrompt.mockResolvedValueOnce('"How many issues did it handle?"');
    const [question] = await askForMetrics([source], LLM);
    expect(question!.question).toBe('How many issues did it handle?');
  });

  it('falls back when the model fails rather than losing the question', async () => {
    runPrompt.mockRejectedValueOnce(new Error('offline'));
    const [question] = await askForMetrics([source], LLM);
    expect(question!.question).toBe(fallbackQuestion(source));
  });

  it('falls back when the model returns a wall of text', async () => {
    // A paragraph beside an input box is worse than a plain question.
    runPrompt.mockResolvedValueOnce('x'.repeat(500));
    const [question] = await askForMetrics([source], LLM);
    expect(question!.question).toBe(fallbackQuestion(source));
  });

  it('falls back on an empty answer', async () => {
    runPrompt.mockResolvedValueOnce('   ');
    const [question] = await askForMetrics([source], LLM);
    expect(question!.question).toBe(fallbackQuestion(source));
  });

  it('asks once per source', async () => {
    runPrompt.mockResolvedValue('How many?');
    const questions = await askForMetrics([source, { ...source, id: 's2', label: 'Other' }], LLM);
    expect(questions.map((q) => q.sourceId)).toEqual(['s1', 's2']);
  });
});

describe('applyAnswer', () => {
  it('appends the user’s own words to the facts', () => {
    // Their sentence is the fact. Generation reframes it like anything else
    // they wrote, rather than treating it as a special input.
    expect(applyAnswer('Built an agent.', 'It resolved 10 of 14 issues correctly.')).toBe(
      'Built an agent.\nIt resolved 10 of 14 issues correctly.'
    );
  });

  it('leaves the facts alone when the question was skipped', () => {
    expect(applyAnswer('Built an agent.', '   ')).toBe('Built an agent.');
  });
});
