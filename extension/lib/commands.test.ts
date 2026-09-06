import { describe, expect, it, vi } from 'vitest';
import { fieldCommands, filterCommands, groupCommands, nextIndex, scoreCommand, type Command } from './commands';
import type { PlannedField } from './field-plan';

const command = (label: string, over: Partial<Command> = {}): Command => ({
  id: label,
  label,
  group: 'Actions',
  run: () => {},
  ...over,
});

describe('scoreCommand', () => {
  it('puts a prefix match above a match in the middle of a word', () => {
    // Typing "tail" must not put "Retail tracker" above "Tailor a resume".
    expect(scoreCommand(command('Tailor a resume'), 'tail')).toBeGreaterThan(
      scoreCommand(command('Retail tracker'), 'tail')
    );
  });

  it('puts an exact match at the top', () => {
    expect(scoreCommand(command('Undo'), 'undo')).toBe(100);
  });

  it('matches a later word at its boundary', () => {
    expect(scoreCommand(command('Write a cover letter'), 'cover')).toBe(60);
  });

  it('matches aliases without showing them', () => {
    expect(scoreCommand(command('Appearance', { aliases: ['theme', 'dark mode'] }), 'dark')).toBeGreaterThan(0);
  });

  it('keeps everything when nothing has been typed', () => {
    expect(scoreCommand(command('Anything'), '   ')).toBe(1);
  });

  it('scores no match at zero', () => {
    expect(scoreCommand(command('Undo'), 'zzz')).toBe(0);
  });
});

describe('filterCommands', () => {
  it('drops what does not match and orders the rest by score', () => {
    const commands = [command('Retail tracker'), command('Tailor a resume'), command('Undo')];
    expect(filterCommands(commands, 'tail').map((c) => c.label)).toEqual([
      'Tailor a resume',
      'Retail tracker',
    ]);
  });

  it('returns everything for an empty query', () => {
    const commands = [command('One'), command('Two')];
    expect(filterCommands(commands, '')).toHaveLength(2);
  });
});

describe('groupCommands', () => {
  it('keeps a fixed group order so the list does not reshuffle as you type', () => {
    const commands = [
      command('Theme', { group: 'Settings' }),
      command('Fill'),
      command('Location', { group: 'Jump to field' }),
    ];
    expect(groupCommands(commands).map(([name]) => name)).toEqual(['Actions', 'Jump to field', 'Settings']);
  });

  it('leaves out a group with nothing in it', () => {
    expect(groupCommands([command('Fill')]).map(([name]) => name)).toEqual(['Actions']);
  });
});

describe('fieldCommands', () => {
  const field = (over: Partial<PlannedField>): PlannedField => ({
    id: 'f',
    label: 'Earliest start date',
    name: 'start_date',
    path: null,
    current: '',
    proposed: '',
    status: 'you',
    group: 'Other',
    ...over,
  });

  it('offers only the fields still worth jumping to', () => {
    const fields = [
      field({ id: 'a', status: 'you' }),
      field({ id: 'b', status: 'ai' }),
      field({ id: 'c', status: 'done' }),
      field({ id: 'd', status: 'skip' }),
      field({ id: 'e', status: 'ready' }),
    ];
    expect(fieldCommands(fields, () => {})).toHaveLength(2);
  });

  it('is findable by its machine name as well as its label', () => {
    const commands = fieldCommands([field({})], () => {});
    expect(scoreCommand(commands[0]!, 'start_date')).toBeGreaterThan(0);
  });

  it('runs the jump for the field it names', () => {
    const jump = vi.fn();
    const target = field({ id: 'x' });
    fieldCommands([target], jump)[0]!.run();
    expect(jump).toHaveBeenCalledWith(target);
  });
});

describe('nextIndex', () => {
  it('wraps at the end, so the list is a loop', () => {
    expect(nextIndex(2, 3, 1)).toBe(0);
  });

  it('wraps at the start', () => {
    expect(nextIndex(0, 3, -1)).toBe(2);
  });

  it('stays put on an empty list rather than dividing by zero', () => {
    expect(nextIndex(0, 0, 1)).toBe(0);
  });
});
