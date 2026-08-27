import { describe, expect, it } from 'vitest';
import { applyProfileDefaults } from './storage';
import { EMPTY_PROFILE } from './schema';

describe('applyProfileDefaults', () => {
  it('backfills projects for profiles saved before the field existed', () => {
    const legacy = { contact: { ...EMPTY_PROFILE.contact, firstName: 'Jordan' } };
    const result = applyProfileDefaults(legacy);
    expect(result.projects).toEqual([]);
    expect(result.contact.firstName).toBe('Jordan');
  });

  it('preserves projects that are already stored', () => {
    const stored = {
      projects: [
        { id: 'a', name: 'ApplyFlow', role: 'Author', description: 'd', techStack: 't', outcomes: 'o' },
      ],
    };
    expect(applyProfileDefaults(stored).projects).toHaveLength(1);
  });
});
