/**
 * The list of models OpenRouter can route to, fetched from their public
 * catalogue. Deliberately does not send the API key: this endpoint does not
 * need one, and a credential should never be sent somewhere that has no use
 * for it.
 *
 * The free roster churns — a model that worked last month can vanish, and a
 * pasted id then fails in a way indistinguishable from any other error. This
 * exists so ids are chosen from what actually exists right now.
 */

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_KEY = 'openrouter-catalog-v1';

/** Long enough that opening Settings is not a network round trip, short enough that a retired model is not offered for long. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CatalogModel {
  id: string;
  name: string;
  contextLength: number;
  /** USD per prompt token, as a number so it can be sorted and compared. */
  promptPrice: number;
  completionPrice: number;
  isFree: boolean;
}

interface CachedCatalogue {
  fetchedAt: number;
  models: CatalogModel[];
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
}

function toPrice(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Turns one catalogue entry into our shape, or null if it is unusable. A
 * single malformed entry must not cost the whole list — OpenRouter adds fields
 * and model kinds regularly, and some of them (voice models, for instance)
 * do not carry the fields a text completion needs.
 */
export function normalizeModel(raw: RawModel): CatalogModel | null {
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!id) return null;

  const promptPrice = toPrice(raw.pricing?.prompt);
  const completionPrice = toPrice(raw.pricing?.completion);
  if (!Number.isFinite(promptPrice)) return null;

  const contextLength = typeof raw.context_length === 'number' ? raw.context_length : 0;

  return {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : id,
    contextLength,
    promptPrice,
    completionPrice: Number.isFinite(completionPrice) ? completionPrice : 0,
    // The `:free` suffix and a zero price do not perfectly overlap — some
    // models are priced at zero without the suffix — so both count.
    isFree: id.endsWith(':free') || promptPrice === 0,
  };
}

export function normalizeCatalogue(payload: unknown): CatalogModel[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.map((entry) => normalizeModel(entry as RawModel)).filter((m): m is CatalogModel => m !== null);
}

async function readCache(): Promise<CachedCatalogue | null> {
  const stored = await browser.storage.local.get(CACHE_KEY);
  const cached = stored[CACHE_KEY] as CachedCatalogue | undefined;
  if (!cached || !Array.isArray(cached.models) || typeof cached.fetchedAt !== 'number') return null;
  return cached;
}

export function isFresh(cached: CachedCatalogue | null, now: number): boolean {
  return cached !== null && now - cached.fetchedAt < CACHE_TTL_MS;
}

/**
 * Returns the catalogue, from cache when it is recent. `force` skips the cache
 * for an explicit refresh. A failed fetch falls back to a stale cache if there
 * is one — an out-of-date list beats no list — and only throws when there is
 * nothing at all to show.
 */
export async function getModels(options: { force?: boolean } = {}): Promise<CatalogModel[]> {
  const cached = await readCache();
  if (!options.force && isFresh(cached, Date.now())) return cached!.models;

  try {
    const response = await fetch(MODELS_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);

    const models = normalizeCatalogue(await response.json());
    if (models.length === 0) throw new Error('The catalogue came back empty.');

    await browser.storage.local.set({ [CACHE_KEY]: { fetchedAt: Date.now(), models } satisfies CachedCatalogue });
    return models;
  } catch (err) {
    if (cached) return cached.models;
    throw new Error(
      `Could not load the model list from OpenRouter (${
        err instanceof Error ? err.message : 'unknown error'
      }). You can still type a model id by hand.`
    );
  }
}
