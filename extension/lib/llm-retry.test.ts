import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseModelList, runPrompt } from './llm-client';
import { LlmError } from './llm-error';
import type { LlmSettings } from './settings';

const LLM: LlmSettings = {
  backend: 'openrouter',
  fallbackBackend: null,
  ollamaModel: '',
  openRouterApiKey: 'k',
  openRouterModel: 'primary/model',
  openRouterFallbackModels: '',
};

const ok = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

/** The shape OpenRouter uses for a saturated upstream: HTTP 200, error inside. */
const upstreamBusy = () =>
  new Response(
    JSON.stringify({
      error: { code: 502, message: 'Upstream error from Nvidia: ResourceExhausted: Worker local total request limit reached (16/16)' },
    }),
    { status: 200 }
  );

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs the promise while letting the retry backoff timers fire immediately. */
async function withTimers<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.catch((err) => ({ __error: err }) as never);
  await vi.runAllTimersAsync();
  const result = (await settled) as T & { __error?: unknown };
  if (result && typeof result === 'object' && '__error' in result) throw result.__error;
  return result;
}

describe('transient failures', () => {
  it('retries a saturated upstream provider and succeeds on the retry', async () => {
    fetchMock.mockResolvedValueOnce(upstreamBusy()).mockResolvedValueOnce(ok('done'));

    await expect(withTimers(runPrompt('hi', LLM))).resolves.toBe('done');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retries and reports the provider’s own reason', async () => {
    // A fresh Response each time: a body can only be read once.
    fetchMock.mockImplementation(async () => upstreamBusy());

    await expect(withTimers(runPrompt('hi', LLM))).rejects.toThrow(/ResourceExhausted/);
    // The first attempt plus both retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a 429 and a 503', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(ok('after wait'));
    await expect(withTimers(runPrompt('hi', LLM))).resolves.toBe('after wait');

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(ok('capacity'));
    await expect(withTimers(runPrompt('hi', LLM))).resolves.toBe('capacity');
  });
});

describe('permanent failures', () => {
  it('does not retry a rejected key', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 401 }));

    await expect(withTimers(runPrompt('hi', LLM))).rejects.toThrow(LlmError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry an unknown model', async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 })
    );

    await expect(withTimers(runPrompt('hi', LLM))).rejects.toThrow(/model/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('model fallbacks', () => {
  it('sends no models array when none are configured', async () => {
    fetchMock.mockImplementation(async () => ok('x'));
    await withTimers(runPrompt('hi', LLM));

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe('primary/model');
    expect(body.models).toBeUndefined();
  });

  it('puts the primary first and the alternatives after it', async () => {
    fetchMock.mockImplementation(async () => ok('x'));
    await withTimers(
      runPrompt('hi', { ...LLM, openRouterFallbackModels: 'a/one, b/two' })
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.models).toEqual(['primary/model', 'a/one', 'b/two']);
  });
});

describe('parseModelList', () => {
  it('accepts commas or newlines and drops blanks', () => {
    expect(parseModelList('a/one,\n b/two , ', 'x/y')).toEqual(['a/one', 'b/two']);
  });

  it('drops the primary so it is not tried twice in a row', () => {
    expect(parseModelList('a/one, primary/model', 'primary/model')).toEqual(['a/one']);
  });
});
