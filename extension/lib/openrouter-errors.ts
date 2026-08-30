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
export function extractOpenRouterText(data: unknown): string {
  const payload = data as { choices?: Choice[]; error?: { message?: string; code?: number } };

  if (payload.error) {
    const code = payload.error.code ? ` (${payload.error.code})` : '';
    throw new LlmError(`OpenRouter reported an error${code}: ${payload.error.message ?? 'no details given'}`);
  }

  const choice = payload.choices?.[0];
  if (!choice) throw new LlmError('OpenRouter returned no completion at all. Try again, or pick a different model.');

  // Reasoning models routinely return an empty `content` with the text in
  // `reasoning`. Using it is better than reporting an empty answer.
  const text = (choice.message?.content || choice.message?.reasoning || '').trim();
  if (text) return text;

  if (choice.finish_reason === 'length') {
    throw new LlmError(
      'The model hit its length limit before producing an answer (finish_reason: length). Try a model with a larger output limit, or a shorter resume.'
    );
  }

  throw new LlmError(
    'The model returned nothing. Free models do this when they are overloaded or when their provider drops the request — try again, or pick a different model.'
  );
}
