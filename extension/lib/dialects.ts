import { LlmError } from './llm-error';
import { describeOpenRouterFailure, extractOpenRouterCompletion, type Completion } from './openrouter-errors';
import { joinUrl, type ProviderSpec } from './providers';

/**
 * Turns one prompt into one HTTP request, and one HTTP response back into an
 * answer, for each wire dialect. Everything above this layer — retries, model
 * rotation, cooldowns, prompt building — is dialect-agnostic.
 */

export interface DialectRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Generous enough for a long answer, capped so a runaway model cannot bill forever. */
const MAX_OUTPUT_TOKENS = 2048;

export function buildRequest(
  provider: ProviderSpec,
  baseUrl: string,
  apiKey: string,
  models: string[],
  prompt: string,
  options: { workspaceId?: string } = {}
): DialectRequest {
  if (provider.dialect === 'ollama') {
    return {
      url: joinUrl(baseUrl, 'api/generate'),
      headers: { 'Content-Type': 'application/json' },
      body: { model: models[0], prompt, stream: false },
    };
  }

  if (provider.dialect === 'anthropic') {
    return {
      url: joinUrl(baseUrl, 'v1/messages'),
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // The API rejects requests carrying a browser Origin unless this is
        // set. An extension sends one, so without it every call fails CORS.
        'anthropic-dangerous-direct-browser-access': 'true',
        // An identity-linked key belongs to a person rather than a workspace,
        // so the API refuses to guess which workspace the request is for.
        // Sent only when set: a workspace-scoped key does not need it.
        ...(options.workspaceId ? { 'anthropic-workspace-id': options.workspaceId } : {}),
        'Content-Type': 'application/json',
      },
      body: {
        model: models[0],
        // Required by this API, unlike the OpenAI shape where it is optional.
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      },
    };
  }

  return {
    url: joinUrl(baseUrl, 'chat/completions'),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: {
      model: models[0],
      // OpenRouter alone walks a fallback list server-side; harmless elsewhere,
      // where an unknown field is ignored.
      ...(models.length > 1 ? { models } : {}),
      messages: [{ role: 'user', content: prompt }],
      max_tokens: MAX_OUTPUT_TOKENS,
    },
  };
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
  stop_reason?: string;
  stop_details?: { category?: string | null; explanation?: string | null };
  usage?: { input_tokens?: number; output_tokens?: number };
}

function readAnthropic(data: unknown): Completion {
  const payload = data as AnthropicResponse;

  // A safety refusal arrives as a successful response with an empty-ish body,
  // so without this it would look like "the model returned nothing".
  if (payload.stop_reason === 'refusal') {
    const why = payload.stop_details?.category ? ` (${payload.stop_details.category})` : '';
    throw new LlmError(`The model declined to answer this question${why}. Try rewording it, or answer it yourself.`);
  }

  const text = (payload.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!.trim())
    .join('\n')
    .trim();

  if (!text) {
    if (payload.stop_reason === 'max_tokens') {
      throw new LlmError('The answer hit the length limit before any text was produced.', true);
    }
    throw new LlmError('The model returned no text.', true);
  }

  return {
    text,
    model: payload.model,
    usage: payload.usage
      ? { input: payload.usage.input_tokens ?? 0, output: payload.usage.output_tokens ?? 0 }
      : undefined,
  };
}

function readOllama(data: unknown, model: string): Completion {
  const payload = data as { response?: string; prompt_eval_count?: number; eval_count?: number };
  const text = (payload.response ?? '').trim();
  if (!text) throw new LlmError('Ollama returned an empty response.', true);
  return {
    text,
    model,
    usage:
      payload.prompt_eval_count !== undefined || payload.eval_count !== undefined
        ? { input: payload.prompt_eval_count ?? 0, output: payload.eval_count ?? 0 }
        : undefined,
  };
}

export function readResponse(provider: ProviderSpec, data: unknown, model: string): Completion {
  if (provider.dialect === 'anthropic') return readAnthropic(data);
  if (provider.dialect === 'ollama') return readOllama(data, model);
  return extractOpenRouterCompletion(data);
}

/**
 * A failed request, explained. OpenRouter's own messages are the most
 * detailed, and its status codes mean the same things everywhere, so its
 * mapping is reused and only the provider-specific wording differs.
 */
export function describeFailure(provider: ProviderSpec, status: number, body: string): string {
  if (provider.dialect === 'ollama') {
    return `Ollama returned ${status}. Is it running, and is the model pulled?`;
  }

  if (provider.id === 'openrouter') return describeOpenRouterFailure(status, body);

  if (status === 401 || status === 403) {
    return `${provider.label} rejected the API key. Check it was copied whole${
      provider.keyUrl ? ` from ${provider.keyUrl}` : ''
    }.`;
  }
  if (status === 404) {
    return `${provider.label} does not have that model, or the base URL is wrong. Check the model id and the endpoint.`;
  }
  if (status === 429) {
    return `${provider.label} rate-limited the request. Wait a moment, or check your usage limits.`;
  }
  if (status === 400 && /workspace[-_ ]?id/i.test(body)) {
    return `${provider.label} needs a workspace id: this key is identity-linked, so it is not tied to one workspace on its own. Add your workspace id in Settings — it is in the Console under Settings → Workspaces.`;
  }
  if (status === 402) return `${provider.label} reports no remaining credit on this account.`;
  if (status >= 500) return `${provider.label} is failing right now (${status}). Try again shortly.`;

  // Deliberately truncated, and never echoing request headers.
  const detail = body.slice(0, 200);
  return `${provider.label} returned ${status}${detail ? `: ${detail}` : ''}`;
}
