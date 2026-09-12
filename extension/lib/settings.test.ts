import { describe, expect, it } from 'vitest';
import { applySettingsDefaults, EMPTY_SETTINGS } from './settings';

describe('applySettingsDefaults', () => {
  it('backfills llm settings for settings saved before the field existed', () => {
    const legacy = { setupCompleted: true };
    const result = applySettingsDefaults(legacy);
    expect(result.llm.backend).toBeNull();
    expect(result.setupCompleted).toBe(true);
  });

  it('preserves a configured llm backend', () => {
    const stored = { llm: { ...EMPTY_SETTINGS.llm, backend: 'ollama' as const } };
    expect(applySettingsDefaults(stored).llm.backend).toBe('ollama');
  });
});

describe('model policy migration', () => {
  it('keeps a model chosen before policies existed', () => {
    const legacy = { llm: { backend: 'openrouter' as const, openRouterModel: 'a/one' } };
    expect(applySettingsDefaults(legacy).llm.modelPolicy).toEqual({ kind: 'single', model: 'a/one' });
  });

  it('folds old fallback models into an ordered list', () => {
    const legacy = { llm: { openRouterModel: 'a/one', openRouterFallbackModels: 'b/two' } };
    expect(applySettingsDefaults(legacy).llm.modelPolicy).toEqual({
      kind: 'list',
      models: ['a/one', 'b/two'],
    });
  });

  it('defaults to the free pool for a fresh install', () => {
    expect(applySettingsDefaults({}).llm.modelPolicy).toEqual({ kind: 'free-pool', minContext: 32_000 });
  });
});
