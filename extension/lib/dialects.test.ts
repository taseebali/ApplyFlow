import { describe, expect, it } from 'vitest';
import { buildRequest, describeFailure, readResponse } from './dialects';
import { providerById } from './providers';

const anthropic = providerById('anthropic');
const openai = providerById('openai');
const openrouter = providerById('openrouter');
const ollama = providerById('ollama');

describe('request shapes', () => {
  it('sends the Anthropic messages shape with its own auth and version headers', () => {
    const req = buildRequest(anthropic, anthropic.baseUrl, 'k', ['claude-sonnet-5'], 'hi');
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('k');
    expect(req.headers.Authorization).toBeUndefined();
    expect(req.headers['anthropic-version']).toBeTruthy();
    // Without this the API refuses a request carrying a browser Origin.
    expect(req.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    // max_tokens is required here, unlike the OpenAI shape.
    expect((req.body as { max_tokens?: number }).max_tokens).toBeGreaterThan(0);
  });

  it('sends the OpenAI shape with bearer auth', () => {
    const req = buildRequest(openai, openai.baseUrl, 'k', ['gpt-4o-mini'], 'hi');
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(req.headers.Authorization).toBe('Bearer k');
    expect(req.headers['x-api-key']).toBeUndefined();
  });

  it('only sends a fallback list to OpenRouter, which understands one', () => {
    const many = ['a/one', 'b/two'];
    expect((buildRequest(openrouter, openrouter.baseUrl, 'k', many, 'hi').body as { models?: string[] }).models)
      .toEqual(many);
    // Other providers get a single model and no stray field.
    expect((buildRequest(openai, openai.baseUrl, 'k', ['gpt-4o-mini'], 'hi').body as { models?: string[] }).models)
      .toBeUndefined();
  });

  it('does not double a slash when the base URL has a trailing one', () => {
    expect(buildRequest(openai, 'https://api.example.com/v1/', 'k', ['m'], 'hi').url).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });

  it('keeps Ollama on its native endpoint with no key', () => {
    const req = buildRequest(ollama, ollama.baseUrl, '', ['llama3.1'], 'hi');
    expect(req.url).toBe('http://localhost:11434/api/generate');
    expect(req.headers.Authorization).toBeUndefined();
  });
});

describe('response reading', () => {
  it('joins Anthropic text blocks and reports the model', () => {
    const completion = readResponse(
      anthropic,
      { model: 'claude-sonnet-5', content: [{ type: 'text', text: ' hello ' }] },
      'asked-for'
    );
    expect(completion.text).toBe('hello');
    expect(completion.model).toBe('claude-sonnet-5');
  });

  it('ignores non-text blocks such as thinking', () => {
    const completion = readResponse(
      anthropic,
      { content: [{ type: 'thinking', text: 'internal' }, { type: 'text', text: 'answer' }] },
      'm'
    );
    expect(completion.text).toBe('answer');
    expect(completion.text).not.toContain('internal');
  });

  it('reports a safety refusal as a refusal, not as an empty answer', () => {
    expect(() =>
      readResponse(anthropic, { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }, 'm')
    ).toThrow(/declined/i);
  });

  it('distinguishes a truncated answer from an empty one', () => {
    expect(() => readResponse(anthropic, { stop_reason: 'max_tokens', content: [] }, 'm')).toThrow(/length limit/i);
  });

  it('reads the OpenAI shape', () => {
    expect(readResponse(openai, { choices: [{ message: { content: 'hi' } }] }, 'm').text).toBe('hi');
  });

  it('reads the Ollama shape', () => {
    expect(readResponse(ollama, { response: 'hi' }, 'llama3.1').model).toBe('llama3.1');
  });
});

describe('failure messages', () => {
  it('names the provider rather than always saying OpenRouter', () => {
    expect(describeFailure(openai, 401, '')).toContain('OpenAI');
    expect(describeFailure(anthropic, 401, '')).toContain('Anthropic');
  });

  it('keeps OpenRouter’s richer mapping for OpenRouter', () => {
    const message = describeFailure(
      openrouter,
      404,
      JSON.stringify({ error: { message: 'No endpoints found matching your data policy' } })
    );
    expect(message).toContain('openrouter.ai/settings/privacy');
  });

  it('does not echo an unbounded response body', () => {
    expect(describeFailure(openai, 400, 'x'.repeat(5000)).length).toBeLessThan(400);
  });
});
