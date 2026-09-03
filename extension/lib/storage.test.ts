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

  it('turns a legacy description into bullets rather than losing it', () => {
    const stored = {
      projects: [
        {
          id: 'a',
          name: 'ApplyFlow',
          role: 'Author',
          description: 'first thing\nsecond thing',
          techStack: 't',
          outcomes: 'o',
        },
      ],
    };
    const [project] = applyProfileDefaults(stored).projects;
    expect(project!.name).toBe('ApplyFlow');
    expect(project!.bullets.map((b) => b.text)).toEqual(['first thing', 'second thing']);
  });
});
