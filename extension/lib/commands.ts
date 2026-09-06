import type { PlannedField } from './field-plan';

/**
 * Everything the panel can do, as one searchable list.
 *
 * A menu tree makes you know where a thing lives before you can reach it. A
 * command list only makes you know what it is called, which is the thing you
 * already know. The same list is the search, the navigation and the shortcut
 * reference, so there is one place to look rather than three.
 */

export type CommandGroup = 'Actions' | 'Jump to field' | 'Settings';

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  /** Shown on the right. Kept as typed, so it can be read back to the user. */
  keys?: string;
  /** Extra words to match on that are not worth showing. */
  aliases?: string[];
  run: () => void;
  /** Present but not runnable, with the reason. */
  disabledReason?: string;
}

/**
 * Ranks by where the match falls, not merely whether it matched.
 *
 * A prefix match is what the user meant; a match in the middle of a word is
 * usually a coincidence. Without this, typing "tail" puts "Retail" above
 * "Tailor a resume".
 */
export function scoreCommand(command: Command, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;

  const haystacks = [command.label, ...(command.aliases ?? [])].map((h) => h.toLowerCase());
  let best = 0;

  for (const hay of haystacks) {
    if (hay === q) best = Math.max(best, 100);
    else if (hay.startsWith(q)) best = Math.max(best, 80);
    // A match at a word boundary reads as intentional; mid-word rarely does.
    else if (hay.includes(` ${q}`)) best = Math.max(best, 60);
    else if (hay.includes(q)) best = Math.max(best, 30);
  }

  return best;
}

export function filterCommands(commands: Command[], query: string): Command[] {
  return commands
    .map((command) => ({ command, score: scoreCommand(command, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.command);
}

/** Groups in a fixed order, so the list does not reshuffle as you type. */
export function groupCommands(commands: Command[]): Array<[CommandGroup, Command[]]> {
  const order: CommandGroup[] = ['Actions', 'Jump to field', 'Settings'];
  return order
    .map((group) => [group, commands.filter((c) => c.group === group)] as [CommandGroup, Command[]])
    .filter(([, items]) => items.length > 0);
}

/**
 * One entry per field that still wants attention.
 *
 * Fields that are done or deliberately skipped are left out: a list of things
 * to jump to should be a list of things worth jumping to.
 */
export function fieldCommands(
  fields: PlannedField[],
  jump: (field: PlannedField) => void
): Command[] {
  return fields
    .filter((field) => field.status === 'you' || field.status === 'ai')
    .map((field) => ({
      id: `field:${field.id}`,
      label: field.label,
      group: 'Jump to field' as const,
      aliases: [field.name],
      run: () => jump(field),
    }));
}

/** Moves the selection, wrapping at both ends so the list is a loop. */
export function nextIndex(current: number, length: number, delta: number): number {
  if (length === 0) return 0;
  return (current + delta + length) % length;
}
