import { describe, expect, it } from 'vitest';
import { applySettingsDefaults, EMPTY_SETTINGS } from './settings';

describe('applySettingsDefaults', () => {
  it('backfills llm settings for settings saved before the field existed', () => {
    const legacy = { notion: { token: 't', databaseId: 'd' } };
    const result = applySettingsDefaults(legacy);
    expect(result.llm.backend).toBeNull();
    expect(result.notion.token).toBe('t');
  });

  it('preserves a configured llm backend', () => {
    const stored = { llm: { ...EMPTY_SETTINGS.llm, backend: 'ollama' as const } };
    expect(applySettingsDefaults(stored).llm.backend).toBe('ollama');
  });
});

describe('notion skip', () => {
  it('defaults to not skipped for settings saved before the flag existed', () => {
    expect(applySettingsDefaults({ notion: { token: 't', databaseId: 'd' } }).notion.skipped).toBe(false);
  });

  it('keeps a stored skip', () => {
    expect(applySettingsDefaults({ notion: { skipped: true } }).notion.skipped).toBe(true);
  });
});
