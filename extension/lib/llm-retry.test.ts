import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPrompt, testLlmConnection } from './llm-client';
import { LlmError } from './llm-error';
import type { LlmSettings } from './settings';

const LLM: LlmSettings = {
  backend: 'openrouter',
  fallbackBackend: null,
  ollamaModel: '',
  openRouterApiKey: 'k',
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKeys: { openrouter: 'k' },
  anthropicWorkspaceId: '',
  modelPolicy: { kind: 'single', model: 'primary/model' },
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
  // The router parks a failed model in session storage; without a stub the
  // first transient failure would throw for the wrong reason.
  const store: Record<string, unknown> = {};
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
      },
      local: {
        get: async () => ({}),
        set: async () => {},
      },
    },
  });
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
  it('sends no models array for a single-model policy', async () => {
    fetchMock.mockImplementation(async () => ok('x'));
    await withTimers(runPrompt('hi', LLM));

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe('primary/model');
    expect(body.models).toBeUndefined();
  });

  it('hands OpenRouter the rest of an ordered list', async () => {
    fetchMock.mockImplementation(async () => ok('x'));
    await withTimers(
      runPrompt('hi', { ...LLM, modelPolicy: { kind: 'list', models: ['primary/model', 'a/one', 'b/two'] } })
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.models).toEqual(['primary/model', 'a/one', 'b/two']);
  });

  it('moves to the next model in the list when one is saturated', async () => {
    fetchMock.mockImplementationOnce(async () => upstreamBusy()).mockImplementation(async () => ok('second'));

    await expect(
      withTimers(runPrompt('hi', { ...LLM, modelPolicy: { kind: 'list', models: ['a/one', 'b/two'] } }))
    ).resolves.toBe('second');

    const second = JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string);
    expect(second.model).toBe('b/two');
  });
});

describe('testing a connection', () => {
  it('uses the key saved for the selected provider', async () => {
    // The check read the old single-key field, so a key saved under apiKeys
    // reported "enter your API key" at someone who had entered one.
    fetchMock.mockImplementation(async () => ok('ok'));

    const result = await withTimers(
      // The real-world state: the legacy field is empty, the key lives in apiKeys.
      testLlmConnection({ ...LLM, openRouterApiKey: '', apiKeys: { openrouter: 'saved-key' } }, 'openrouter')
    );
    expect(result.ok).toBe(true);
  });

  it('sends that key on the request', async () => {
    fetchMock.mockImplementation(async () => ok('ok'));
    await withTimers(
      testLlmConnection({ ...LLM, openRouterApiKey: '', apiKeys: { openrouter: 'saved-key' } }, 'openrouter')
    );

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer saved-key');
  });

  it('asks for a key only when there genuinely is not one', async () => {
    const result = await withTimers(testLlmConnection({ ...LLM, apiKeys: {} }, 'openrouter'));
    expect(result).toEqual({ ok: false, message: expect.stringContaining('OpenRouter') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names the provider that is actually selected', async () => {
    const result = await withTimers(
      testLlmConnection({ ...LLM, provider: 'anthropic', apiKeys: {} }, 'openrouter')
    );
    expect(result).toEqual({ ok: false, message: expect.stringContaining('Anthropic') });
  });

  it('does not ask Ollama for a key it never needs', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ response: 'ok' }), { status: 200 }));
    const result = await withTimers(
      testLlmConnection({ ...LLM, provider: 'ollama', backend: 'ollama', apiKeys: {} }, 'ollama')
    );
    expect(result.ok).toBe(true);
  });
});
