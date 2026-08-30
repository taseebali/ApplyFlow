import { describe, expect, it } from 'vitest';
import { LlmError } from './llm-client';
import { describeOpenRouterFailure, extractOpenRouterText } from './openrouter-errors';

describe('describeOpenRouterFailure', () => {
  it('names the data-policy setting, which is what blocks most :free models', () => {
    const message = describeOpenRouterFailure(
      404,
      JSON.stringify({ error: { message: 'No endpoints found matching your data policy (Free model publication).' } })
    );
    expect(message).toContain('data policy');
    expect(message).toContain('openrouter.ai/settings/privacy');
  });

  it('distinguishes an unknown model from a data-policy block', () => {
    const message = describeOpenRouterFailure(404, JSON.stringify({ error: { message: 'No allowed providers' } }));
    expect(message).toContain('model');
    expect(message).not.toContain('openrouter.ai/settings/privacy');
  });

  it('explains a rejected key without echoing it', () => {
    expect(describeOpenRouterFailure(401, '{"error":{"message":"No auth credentials found"}}')).toContain('API key');
  });

  it('separates being out of credits from being rate limited', () => {
    expect(describeOpenRouterFailure(402, '')).toContain('credit');
    expect(describeOpenRouterFailure(429, '')).toContain('limit');
  });

  it('says a free model has a daily cap when the body mentions one', () => {
    const message = describeOpenRouterFailure(429, '{"error":{"message":"Rate limit exceeded: free-models-per-day"}}');
    expect(message).toContain('day');
  });

  it('points at the provider for a server error', () => {
    expect(describeOpenRouterFailure(503, '')).toContain('provider');
  });

  it('falls back to the status and the body for anything unrecognised', () => {
    const message = describeOpenRouterFailure(418, 'teapot');
    expect(message).toContain('418');
    expect(message).toContain('teapot');
  });
});

describe('extractOpenRouterText', () => {
  it('reads an ordinary completion', () => {
    expect(
      extractOpenRouterText({ choices: [{ message: { content: '  hello  ' } }] })
    ).toBe('hello');
  });

  it('falls back to reasoning, which is where some free models put the answer', () => {
    expect(
      extractOpenRouterText({ choices: [{ message: { content: '', reasoning: 'the answer' } }] })
    ).toBe('the answer');
  });

  it('throws on an error body returned with a 200, rather than looking like an empty answer', () => {
    expect(() =>
      extractOpenRouterText({ error: { message: 'Provider returned error', code: 429 } })
    ).toThrow(LlmError);
  });

  it('explains an empty completion instead of silently returning nothing', () => {
    expect(() => extractOpenRouterText({ choices: [{ message: { content: '' } }] })).toThrow(/nothing/i);
  });

  it('reports a truncated answer as a failure the user can act on', () => {
    expect(() =>
      extractOpenRouterText({ choices: [{ message: { content: '' }, finish_reason: 'length' }] })
    ).toThrow(/length|cut off/i);
  });
});
