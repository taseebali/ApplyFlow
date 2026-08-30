/**
 * Where drafting can run.
 *
 * Almost every hosted provider now speaks OpenAI's `/chat/completions` shape,
 * so two wire dialects cover the field: `openai` for that majority, and
 * `anthropic` for Claude's `/v1/messages`, which differs enough (its own auth
 * header, a required `max_tokens`, content as a block array) that pretending
 * otherwise would mean silent breakage. Ollama keeps its native dialect
 * because that path is already working and tested.
 *
 * Adding a provider that speaks the OpenAI shape is a row in this table, not
 * new code.
 */

export type Dialect = 'openai' | 'anthropic' | 'ollama';

export interface ProviderSpec {
  id: string;
  label: string;
  dialect: Dialect;
  baseUrl: string;
  /** Matched against `host_permissions`; a custom base URL needs a runtime grant. */
  origin: string;
  needsKey: boolean;
  /** Where the user gets a key, shown next to the field. */
  keyUrl?: string;
  defaultModel: string;
  /** Whether the model list can be fetched, and whether that needs the key. */
  catalogue: 'public' | 'authenticated' | 'none';
  note?: string;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    dialect: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    origin: 'https://openrouter.ai/*',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'google/gemini-2.0-flash-001',
    catalogue: 'public',
    note: 'One key, hundreds of models, including free ones. The only provider here with a rotating free pool.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    dialect: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    origin: 'https://api.anthropic.com/*',
    needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-sonnet-5',
    catalogue: 'authenticated',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    dialect: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    origin: 'https://api.openai.com/*',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    catalogue: 'authenticated',
  },
  {
    id: 'groq',
    label: 'Groq',
    dialect: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    origin: 'https://api.groq.com/*',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile',
    catalogue: 'authenticated',
  },
  {
    id: 'ollama',
    label: 'On my computer (Ollama)',
    dialect: 'ollama',
    baseUrl: 'http://localhost:11434',
    origin: 'http://localhost:11434/*',
    needsKey: false,
    defaultModel: 'llama3.1',
    catalogue: 'none',
    note: 'Runs locally. Nothing leaves your machine, and it costs nothing.',
  },
  {
    id: 'custom',
    label: 'Something else (OpenAI-compatible)',
    dialect: 'openai',
    // Filled in by the user; anything speaking /chat/completions works —
    // Together, DeepSeek, Fireworks, LM Studio, vLLM, a self-hosted gateway.
    baseUrl: '',
    origin: '',
    needsKey: true,
    defaultModel: '',
    catalogue: 'authenticated',
    note: 'Any endpoint that speaks OpenAI’s /chat/completions. Needs permission for the host, which you will be asked for once.',
  },
];

export function providerById(id: string): ProviderSpec {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;
}

/** Trailing slashes double up when joined, and some gateways 404 on `//`. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** The origin pattern a custom base URL needs permission for. */
export function originPatternFor(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}
