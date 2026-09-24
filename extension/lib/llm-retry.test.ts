import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attemptPlan, isSafeEndpoint, runPrompt, testLlmConnection } from './llm-client';
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
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
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

  it('never hands OpenRouter a list to fall back through', async () => {
    // It used to send the whole ordered list as their `models` array, which
    // made the fallback theirs: a 504 on our first choice was retried against
    // whatever their router picked next, and one of those was a paid music
    // model. One model per request, and we walk the list ourselves.
    fetchMock.mockImplementation(async () => ok('x'));
    await withTimers(
      runPrompt('hi', { ...LLM, modelPolicy: { kind: 'list', models: ['primary/model', 'a/one', 'b/two'] } })
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe('primary/model');
    expect(body.models).toBeUndefined();
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

describe('parameter-name recovery', () => {
  const refusal = () =>
    new Response(
      JSON.stringify({
        error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." },
      }),
      { status: 400 }
    );

  it('resends under the other name and succeeds, without troubling the user', async () => {
    fetchMock.mockImplementationOnce(async () => refusal()).mockImplementation(async () => ok('drafted'));

    await expect(withTimers(runPrompt('hi', LLM))).resolves.toBe('drafted');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const second = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(second.max_completion_tokens).toBeGreaterThan(0);
    expect('max_tokens' in second).toBe(false);
  });

  it('reports the failure when the other name does not help either', async () => {
    fetchMock.mockImplementation(async () => refusal());
    await expect(withTimers(runPrompt('hi', LLM))).rejects.toThrow();
    // One attempt, one swap — and no retry loop, since a 400 is not transient.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('a model the provider will not serve at all', () => {
  /** Verbatim from OpenRouter, on a model that is genuinely free and text-only. */
  const gated = () =>
    new Response(
      JSON.stringify({
        error: {
          message:
            'thinkingmachines/inkling-small:free is only available on agentic harnesses. Try plugging it into a coding agent or productivity app listed on https://openrouter.ai/apps',
        },
      }),
      { status: 403 }
    );

  it('moves to the next model instead of failing the run', async () => {
    // Read as an auth failure this stopped everything, so Test connection
    // reported failure while seventeen other free models sat unused.
    fetchMock.mockImplementationOnce(async () => gated()).mockImplementation(async () => ok('second'));

    await expect(
      withTimers(runPrompt('hi', { ...LLM, modelPolicy: { kind: 'list', models: ['gated/one', 'good/two'] } }))
    ).resolves.toBe('second');

    const second = JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string);
    expect(second.model).toBe('good/two');
  });

  it('still fails on a 403 that is about the key', async () => {
    // A rejected key must not look like a model to skip past, or a wrong key
    // burns every candidate in the pool before reporting anything useful.
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: { message: 'User not found.' } }), { status: 403 })
    );

    await expect(
      withTimers(runPrompt('hi', { ...LLM, modelPolicy: { kind: 'list', models: ['a/one', 'b/two'] } }))
    ).rejects.toThrow();
    // One attempt per model, not a retry storm against a key that is wrong.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the connection test is a probe, not a run', () => {
  it('asks once and gives up, rather than walking every model and retrying', async () => {
    // The bug: a test went through the full drafting path — three retries,
    // each walking up to three candidates, each with a 90-second timeout. A
    // wrong key could sit on "Testing…" for thirteen minutes, which reads as a
    // button that does nothing.
    fetchMock.mockImplementation(async () => upstreamBusy());

    const result = await withTimers(
      testLlmConnection(
        { ...LLM, modelPolicy: { kind: 'list', models: ['a/one', 'b/two', 'c/three'] } },
        'openrouter'
      )
    );

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says which model answered, since a pool picks one for you', async () => {
    fetchMock.mockImplementation(async () => ok('ok'));
    const result = await withTimers(testLlmConnection(LLM, 'openrouter'));
    expect(result).toEqual({ ok: true, model: 'primary/model' });
  });
});

describe('where a key may be sent', () => {
  it('refuses a plaintext endpoint, which the permission button already refused', async () => {
    // `originPatternFor` will not grant a host permission for http://, but a
    // cross-origin fetch to a host answering with permissive CORS needs no
    // permission — and the request carries Authorization: Bearer <key>.
    const result = await withTimers(
      testLlmConnection(
        { ...LLM, provider: 'custom', baseUrl: 'http://attacker.example/v1', apiKeys: { custom: 'k' } },
        'openrouter'
      )
    );

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a model running on this machine over plain http', async () => {
    fetchMock.mockImplementation(async () => ok('ok'));
    const result = await withTimers(
      testLlmConnection(
        { ...LLM, provider: 'custom', baseUrl: 'http://localhost:1234/v1', apiKeys: { custom: 'k' } },
        'openrouter'
      )
    );
    expect(result.ok).toBe(true);
  });

  it('does not take a lookalike host for loopback', () => {
    expect(isSafeEndpoint('http://localhost.evil.com/v1')).toBe(false);
    expect(isSafeEndpoint('http://127.0.0.1:11434')).toBe(true);
    expect(isSafeEndpoint('https://api.openai.com/v1')).toBe(true);
    expect(isSafeEndpoint('not a url')).toBe(false);
  });
});

describe('what one answer is allowed to cost', () => {
  it('spends three requests across three models, not nine', async () => {
    // The bug: runWith retried three times and each retry walked three
    // candidates, so one drafted answer could cost nine requests — and a run
    // of five questions, forty-five.
    fetchMock.mockImplementation(async () => upstreamBusy());

    await withTimers(
      runPrompt('hi', { ...LLM, modelPolicy: { kind: 'list', models: ['a/one', 'b/two', 'c/three'] } })
    ).catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('spends the same three on one model when there is nowhere else to go', async () => {
    fetchMock.mockImplementation(async () => upstreamBusy());

    await withTimers(runPrompt('hi', { ...LLM, modelPolicy: { kind: 'single', model: 'only/one' } })).catch(
      () => undefined
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops at the first model that answers', async () => {
    fetchMock.mockImplementationOnce(async () => upstreamBusy()).mockImplementation(async () => ok('done'));

    const text = await withTimers(
      runPrompt('hi', { ...LLM, modelPolicy: { kind: 'list', models: ['a/one', 'b/two', 'c/three'] } })
    );

    expect(text).toBe('done');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failure that is not transient', async () => {
    // A bad key is not worth three requests.
    fetchMock.mockImplementation(async () => new Response('{"error":{"message":"invalid key"}}', { status: 401 }));

    await withTimers(runPrompt('hi', { ...LLM, modelPolicy: { kind: 'list', models: ['a/one', 'b/two'] } })).catch(
      () => undefined
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('attemptPlan', () => {
  it('walks the models it has, then repeats to fill the budget', () => {
    expect(attemptPlan(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(attemptPlan(['a', 'b'])).toEqual(['a', 'b', 'a']);
    expect(attemptPlan(['a'])).toEqual(['a', 'a', 'a']);
    expect(attemptPlan(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
    expect(attemptPlan([])).toEqual([]);
  });
});

describe('a model closed to ordinary keys', () => {
  const gated = () =>
    new Response(
      JSON.stringify({
        error: { message: 'thinkingmachines/inkling-small:free is only available on agentic harnesses' },
      }),
      { status: 404 }
    );

  it('is skipped by the connection test rather than reported as a broken key', async () => {
    // The screenshot this exists for: "Test connection FAILED — that model is
    // not open to ordinary API keys", while nineteen other models in the pool
    // would have answered. The button answers "does my key work", and a gated
    // model says nothing about the key.
    fetchMock.mockImplementationOnce(async () => gated()).mockImplementation(async () => ok('ok'));

    const result = await withTimers(
      testLlmConnection({ ...LLM, modelPolicy: { kind: 'list', models: ['gated/one', 'good/two'] } }, 'openrouter')
    );

    expect(result).toEqual({ ok: true, model: 'good/two' });
  });

  it('still stops at a bad key, which is an answer', async () => {
    fetchMock.mockImplementation(async () => new Response('{"error":{"message":"invalid"}}', { status: 401 }));

    const result = await withTimers(
      testLlmConnection({ ...LLM, modelPolicy: { kind: 'list', models: ['a/one', 'b/two'] } }, 'openrouter')
    );

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
