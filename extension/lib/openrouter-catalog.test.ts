import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getModels, isFresh, normalizeCatalogue, normalizeModel } from './openrouter-catalog';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'vendor/model',
  name: 'A Model',
  context_length: 128000,
  pricing: { prompt: '0.0000001', completion: '0.0000002' },
  ...over,
});

describe('normalizeModel', () => {
  it('parses string prices into numbers', () => {
    const model = normalizeModel(entry())!;
    expect(model.promptPrice).toBeCloseTo(0.0000001);
    expect(model.contextLength).toBe(128000);
    expect(model.isFree).toBe(false);
  });

  it('treats a :free suffix as free', () => {
    expect(normalizeModel(entry({ id: 'vendor/model:free' }))!.isFree).toBe(true);
  });

  it('treats a zero price as free even without the suffix', () => {
    expect(normalizeModel(entry({ pricing: { prompt: '0', completion: '0' } }))!.isFree).toBe(true);
  });

  it('falls back to the id when a model has no name', () => {
    expect(normalizeModel(entry({ name: undefined }))!.name).toBe('vendor/model');
  });

  it('rejects an entry with no id or no usable price', () => {
    expect(normalizeModel(entry({ id: undefined }))).toBeNull();
    expect(normalizeModel(entry({ pricing: undefined }))).toBeNull();
    expect(normalizeModel(entry({ pricing: { prompt: 'n/a' } }))).toBeNull();
  });
});

describe('normalizeCatalogue', () => {
  it('keeps the good entries and drops the unusable ones', () => {
    const models = normalizeCatalogue({ data: [entry(), { id: 'broken' }, entry({ id: 'b/two' })] });
    expect(models.map((m) => m.id)).toEqual(['vendor/model', 'b/two']);
  });

  it('returns nothing rather than throwing on an unexpected payload', () => {
    expect(normalizeCatalogue({})).toEqual([]);
    expect(normalizeCatalogue(null)).toEqual([]);
    expect(normalizeCatalogue({ data: 'nope' })).toEqual([]);
  });
});

describe('isFresh', () => {
  const now = 1_000_000_000_000;
  it('is fresh within a day and stale after', () => {
    expect(isFresh({ fetchedAt: now - 1000, models: [] }, now)).toBe(true);
    expect(isFresh({ fetchedAt: now - 25 * 60 * 60 * 1000, models: [] }, now)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
  });
});

describe('getModels', () => {
  let store: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = {};
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
          set: async (items: Record<string, unknown>) => {
            Object.assign(store, items);
          },
        },
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  const respondWith = (models: unknown[]) =>
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: models }), { status: 200 }));

  it('does not send the API key to a public endpoint', async () => {
    respondWith([entry()]);
    await getModels();

    const init = fetchMock.mock.calls[0]![1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('serves a second call from cache without fetching again', async () => {
    respondWith([entry()]);
    await getModels();
    await getModels();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when forced', async () => {
    respondWith([entry()]);
    await getModels();
    await getModels({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to a stale cache when the network fails', async () => {
    respondWith([entry()]);
    await getModels();

    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(getModels({ force: true })).resolves.toHaveLength(1);
  });

  it('explains itself when there is no cache to fall back on', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(getModels()).rejects.toThrow(/by hand/);
  });

  it('treats an empty catalogue as a failure rather than caching it', async () => {
    respondWith([]);
    await expect(getModels()).rejects.toThrow();
    expect(store['openrouter-catalog-v1']).toBeUndefined();
  });
});
