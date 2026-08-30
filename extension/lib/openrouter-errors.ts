import { LlmError } from './llm-error';

/**
 * OpenRouter reports why a request was refused in the response body, and the
 * reasons are all things the user can actually do something about — but only
 * if they are told which one it was. A bare "returned 404" sends people
 * changing models when the real fix is one checkbox in their account.
 */

function bodyMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? '';
  } catch {
    return body;
  }
}

export function describeOpenRouterFailure(status: number, body: string): string {
  const detail = bodyMessage(body);

  if (status === 401) {
    return 'OpenRouter rejected the API key. Check it was copied whole from openrouter.ai/keys, and that it has not been revoked.';
  }

  if (status === 402) {
    return 'OpenRouter says this account is out of credit. Add credit, or switch to a model that costs nothing.';
  }

  if (status === 404) {
    // The single most common reason every :free model fails at once: free
    // endpoints are served by providers that may train on what is sent, and an
    // account has to opt into that before any of them will route.
    if (/data policy/i.test(detail)) {
      return 'No provider matched this account’s data policy. Free models are served by providers that may train on what is sent, so they only work once that is allowed: open openrouter.ai/settings/privacy and enable the free-model / prompt-training options, or switch to a paid model.';
    }
    return `OpenRouter does not have that model. Check the model id against openrouter.ai/models — it must be the full id, such as "google/gemini-2.0-flash-001".${
      detail ? ` (${detail})` : ''
    }`;
  }

  if (status === 429) {
    if (/per-?day|daily/i.test(detail)) {
      return 'OpenRouter’s daily limit for free models has been used up for today. Free keys get a small number of requests a day; wait for the reset, add credit to raise it, or use a paid model or Ollama.';
    }
    return 'OpenRouter rate-limited the request. Free models allow only a few requests a minute — wait a moment and try again, or use a paid model or Ollama.';
  }

  if (status === 503) {
    return `No provider had capacity for that model. Free endpoints are shared and fill up — try again, or add a fallback model.${
      detail ? ` (${detail})` : ''
    }`;
  }

  if (status >= 500) {
    return `The model provider is failing right now (${status}). This is on their side — try again, or pick a different model.${
      detail ? ` (${detail})` : ''
    }`;
  }

  return `OpenRouter returned ${status}${detail ? `: ${detail.slice(0, 200)}` : ''}`;
}

interface Choice {
  message?: { content?: string; reasoning?: string };
  finish_reason?: string;
}

/**
 * Pulls the answer out of a 200 response. Three things go wrong here that all
 * look identical to a naive `choices[0].message.content`: an error delivered
 * with a 200 status, a reasoning model that leaves `content` empty and puts
 * everything in `reasoning`, and an answer cut off before it began. Each of
 * those would otherwise surface as "the AI found nothing".
 */
export interface TokenUsage {
  input: number;
  output: number;
}

export interface Completion {
  text: string;
  /** What the request cost in tokens, when the provider reports it. */
  usage?: TokenUsage;
  /** Which model actually answered. With a rotating pool this is not
   * necessarily the one that was asked for, and the difference matters. */
  model?: string;
}

export function extractOpenRouterCompletion(data: unknown): Completion {
  const payload = data as {
    choices?: Choice[];
    error?: { message?: string; code?: number };
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  if (payload.error) {
    const code = payload.error.code;
    // A saturated upstream provider arrives here, not as an HTTP status: the
    // request to OpenRouter itself succeeded, and the failure is reported
    // inside the body. It is worth retrying; a 4xx in the same place is not.
    const transient = code === undefined || code === 429 || code >= 500;
    const shown = code ? ` (${code})` : '';
    throw new LlmError(
      `OpenRouter reported an error${shown}: ${payload.error.message ?? 'no details given'}`,
      transient
    );
  }

  const choice = payload.choices?.[0];
  if (!choice)
    throw new LlmError('OpenRouter returned no completion at all. Try again, or pick a different model.', true);

  // Reasoning models routinely return an empty `content` with the text in
  // `reasoning`. Using it is better than reporting an empty answer.
  const text = (choice.message?.content || choice.message?.reasoning || '').trim();
  if (text) {
    return {
      text,
      model: typeof payload.model === 'string' ? payload.model : undefined,
      usage: payload.usage
        ? { input: payload.usage.prompt_tokens ?? 0, output: payload.usage.completion_tokens ?? 0 }
        : undefined,
    };
  }

  if (choice.finish_reason === 'length') {
    throw new LlmError(
      'The model hit its length limit before producing an answer (finish_reason: length). Try a model with a larger output limit, or a shorter resume.'
    );
  }

  throw new LlmError(
    'The model returned nothing. Free models do this when they are overloaded or when their provider drops the request — try again, or pick a different model.',
    true
  );
}

/**
 * Whether an HTTP-level failure is worth sending again. Capacity and rate
 * limits clear on their own; a rejected key or a missing model never will.
 */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** The answer text alone, for callers that do not care which model produced it. */
export function extractOpenRouterText(data: unknown): string {
  return extractOpenRouterCompletion(data).text;
}
