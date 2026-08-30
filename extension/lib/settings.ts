export interface LlmSettings {
  /** null means "not configured" — the drafting feature stays inactive. */
  backend: 'ollama' | 'openrouter' | null;
  /**
   * Tried when the primary backend fails. Both can be configured at once so a
   * hosted model can do the work while a local one covers an outage, a rate
   * limit, or being offline.
   */
  fallbackBackend: 'ollama' | 'openrouter' | null;
  ollamaModel: string;
  openRouterApiKey: string;
  openRouterModel: string;
  /**
   * Comma-separated model ids tried, in order, when the first one errors or its
   * provider is out of capacity. OpenRouter walks the list server-side, which
   * is the only thing that helps when a free endpoint is simply full.
   */
  openRouterFallbackModels: string;
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
    ollamaModel: 'llama3.1',
    openRouterApiKey: '',
    // Deliberately a small, cheap model: this workload is structured
    // extraction plus a short first draft the user edits, not hard reasoning.
    openRouterModel: 'google/gemini-2.0-flash-001',
    openRouterFallbackModels: '',
  },
  setupCompleted: false,
};

const SETTINGS_KEY = 'settings';

/** Backfills any sections added to Settings after a user's data was last saved. */
type StoredSettings = {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
};

export function applySettingsDefaults(stored: StoredSettings): Settings {
  return {
    notion: { ...EMPTY_SETTINGS.notion, ...stored.notion },
    llm: { ...EMPTY_SETTINGS.llm, ...stored.llm },
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
