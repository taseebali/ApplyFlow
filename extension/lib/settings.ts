export interface LlmSettings {
  /** null means "not configured" — the drafting feature stays inactive. */
  backend: 'ollama' | 'openrouter' | null;
  ollamaModel: string;
  openRouterApiKey: string;
  openRouterModel: string;
}

export interface Settings {
  notion: {
    token: string;
    databaseId: string;
  };
  llm: LlmSettings;
}

export const EMPTY_SETTINGS: Settings = {
  notion: { token: '', databaseId: '' },
  llm: {
    backend: null,
    ollamaModel: 'llama3.1',
    openRouterApiKey: '',
    openRouterModel: 'anthropic/claude-3.5-sonnet',
  },
};

const SETTINGS_KEY = 'settings';

/** Backfills any sections added to Settings after a user's data was last saved. */
export function applySettingsDefaults(stored: Partial<Settings>): Settings {
  return {
    notion: { ...EMPTY_SETTINGS.notion, ...stored.notion },
    llm: { ...EMPTY_SETTINGS.llm, ...stored.llm },
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
