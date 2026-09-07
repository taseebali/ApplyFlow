import { describe, expect, it } from 'vitest';
import { parseSkillRows, serializeSkillRows } from './skill-groups';

describe('parseSkillRows', () => {
  it('reads a labelled entry as a group', () => {
    expect(parseSkillRows(['Languages: Python, TypeScript'])).toEqual([
      { label: 'Languages', items: ['Python', 'TypeScript'] },
    ]);
  });

  it('collapses every loose skill into one row, where the resume prints them', () => {
    expect(parseSkillRows(['Docker', 'Git'])).toEqual([{ label: '', items: ['Docker', 'Git'] }]);
  });

  it('puts the loose row last, whatever order it arrived in', () => {
    const rows = parseSkillRows(['Docker', 'Languages: Python', 'Git']);
    expect(rows.map((r) => r.label)).toEqual(['Languages', '']);
    expect(rows[1]!.items).toEqual(['Docker', 'Git']);
  });

  it('ignores a colon that is not a label — a URL is not a group', () => {
    // `groupSkills` needs 2-40 characters before the colon, so this stays loose
    // rather than becoming a group called "https".
    expect(parseSkillRows(['https://example.com'])[0]!.label).toBe('');
  });

  it('drops blank entries rather than making an empty chip', () => {
    expect(parseSkillRows(['', '   '])).toEqual([]);
  });
});

describe('serializeSkillRows', () => {
  it('writes a group back in the shape the resume reads', () => {
    expect(serializeSkillRows([{ label: 'Languages', items: ['Python', 'Go'] }])).toEqual([
      'Languages: Python, Go',
    ]);
  });

  it('writes loose skills as one entry each', () => {
    expect(serializeSkillRows([{ label: '', items: ['Docker', 'Git'] }])).toEqual(['Docker', 'Git']);
  });

  it('drops a row that has a label but nothing in it', () => {
    // Typing a group name and then thinking better of it should leave no trace.
    expect(serializeSkillRows([{ label: 'Cloud', items: [] }])).toEqual([]);
  });

  it('round-trips anything the resume can read', () => {
    const stored = ['Languages: Python, TypeScript', 'Tools: Docker, Git', 'Kubernetes'];
    expect(serializeSkillRows(parseSkillRows(stored))).toEqual(stored);
  });
});
