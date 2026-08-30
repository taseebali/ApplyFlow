import { policyFromLegacy, type ModelPolicy } from './model-router';
import { providerById } from './providers';

export interface LlmSettings {
  /** null means "not configured" — the drafting feature stays inactive. */
  backend: 'ollama' | 'openrouter' | null;
  /**
   * Which provider drafting runs against: a row in `lib/providers.ts`. The
   * older `backend` field is kept because it still selects the fallback, and
   * because settings saved before providers existed are read through it.
   */
  provider: string;
  /** Overrides the provider's default endpoint. Only meaningful for `custom`. */
  baseUrl: string;
  /**
   * One key per provider, so switching between them does not mean re-pasting.
   * Never logged, never sent anywhere but that provider's own endpoint.
   */
  apiKeys: Record<string, string>;
  /**
   * Tried when the primary backend fails. Both can be configured at once so a
   * hosted model can do the work while a local one covers an outage, a rate
   * limit, or being offline.
   */
  fallbackBackend: 'ollama' | 'openrouter' | null;
  ollamaModel: string;
  openRouterApiKey: string;
  /**
   * How a model is picked for each request. Replaces the single pasted model
   * id: free endpoints saturate, and a policy can move to another one instead
   * of failing. See `lib/model-router.ts`.
   */
  modelPolicy: ModelPolicy;
}

export interface Settings {
  notion: {
    token: string;
    databaseId: string;
    /**
     * Set when the user has said they do not use Notion. Distinct from simply
     * having no token: an unconfigured tracker keeps nagging, a skipped one
     * gets out of the way until the user asks for it back.
     */
    skipped: boolean;
  };
  llm: LlmSettings;
  /** True once the user has been through setup at least once (even if every step was skipped). */
  setupCompleted: boolean;
}

export const EMPTY_SETTINGS: Settings = {
  notion: { token: '', databaseId: '', skipped: false },
  llm: {
    backend: null,
    fallbackBackend: null,
    provider: 'openrouter',
    baseUrl: '',
    apiKeys: {},
    ollamaModel: 'llama3.1',
    openRouterApiKey: '',
    // Free models by default, rotating across whatever the catalogue currently
    // offers. Costs nothing and routes around a saturated provider — at the
    // price of sending the resume to providers that may train on it, which the
    // settings UI states plainly at the point of choosing.
    modelPolicy: { kind: 'free-pool', minContext: 32_000 },
  },
  setupCompleted: false,
};

const SETTINGS_KEY = 'settings';

/** Backfills any sections added to Settings after a user's data was last saved. */
/**
 * Settings as they may exist on disk: every section partial, plus the fields
 * that older versions wrote and `migrateLlm` still reads. Naming them here
 * keeps the migration honest rather than casting it away at the call site.
 */
type LegacyLlmFields = { openRouterModel?: string; openRouterFallbackModels?: string };

type StoredSettings = {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
} & { llm?: Partial<LlmSettings> & LegacyLlmFields };

/**
 * Settings saved before policies existed carry `openRouterModel` and
 * `openRouterFallbackModels` instead. Fold them into an equivalent policy so
 * nobody's chosen model is silently replaced by the new default.
 */
function migrateLlm(stored: Partial<LlmSettings> & LegacyLlmFields) {
  const merged = { ...EMPTY_SETTINGS.llm, ...stored };
  if (!stored.modelPolicy && stored.openRouterModel) {
    merged.modelPolicy = policyFromLegacy(stored.openRouterModel, stored.openRouterFallbackModels ?? '');
  }

  // Settings written before providers existed named their backend directly,
  // and kept the OpenRouter key in its own field.
  if (!stored.provider && stored.backend) merged.provider = stored.backend;
  merged.apiKeys = { ...merged.apiKeys };
  if (stored.openRouterApiKey && !merged.apiKeys.openrouter) {
    merged.apiKeys.openrouter = stored.openRouterApiKey;
  }
  if (!merged.baseUrl) merged.baseUrl = providerById(merged.provider).baseUrl;

  return merged;
}

export function applySettingsDefaults(stored: StoredSettings): Settings {
  return {
    notion: { ...EMPTY_SETTINGS.notion, ...stored.notion },
    llm: migrateLlm(stored.llm ?? {}),
    setupCompleted: stored.setupCompleted ?? EMPTY_SETTINGS.setupCompleted,
  };
}

export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<Settings> | undefined;
  return stored ? applySettingsDefaults(stored) : EMPTY_SETTINGS;
}

export async function setSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}
