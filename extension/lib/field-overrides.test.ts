import { describe, expect, it } from 'vitest';
import { applyOverrideDefaults } from './field-overrides';

describe('applyOverrideDefaults', () => {
  it('keeps well-formed mappings', () => {
    const stored = { 'jobs.example.com': { custom_attr_1: 'contact.phone' } };
    expect(applyOverrideDefaults(stored)).toEqual(stored);
  });

  it('returns an empty map for missing or malformed storage', () => {
    expect(applyOverrideDefaults(undefined)).toEqual({});
    expect(applyOverrideDefaults('nope')).toEqual({});
    expect(applyOverrideDefaults({ host: 'not-an-object' })).toEqual({});
  });

  it('drops entries whose target is not a schema path', () => {
    const stored = { host: { good: 'contact.email', bad: 42, empty: '' } };
    expect(applyOverrideDefaults(stored)).toEqual({ host: { good: 'contact.email' } });
  });

  it('drops a host left with no usable mappings', () => {
    expect(applyOverrideDefaults({ host: { bad: null } })).toEqual({});
  });
});
