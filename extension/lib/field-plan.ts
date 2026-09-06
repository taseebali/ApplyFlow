/**
 * What would be written to this form, worked out without writing any of it.
 *
 * One computation feeds three things that used to be separate and inconsistent:
 * the panel's field list, the diff shown before approval, and the fill itself.
 * Previously the panel knew only counts after the fact - "11 filled, 3
 * unmatched" - which is why it could never say what it was about to do, and why
 * a wrong value was discovered by looking at the page rather than at the panel.
 */

export type FieldStatus =
  /** Already holds what we would write. Nothing to do. */
  | 'done'
  /** We have a value and it differs from what is there. */
  | 'ready'
  /** Recognised, but only the user can supply this. */
  | 'you'
  /** An open question a model would answer. */
  | 'ai'
  /** Seen and deliberately left alone. */
  | 'skip';

export interface PlannedField {
  /** Stable within one plan; used as a React key and to address one field. */
  id: string;
  /** What the form calls it, in the form's own words. */
  label: string;
  /** A short machine name for the mono column. */
  name: string;
  /** The profile path this matched, or null when unidentified. */
  path: string | null;
  /** What the field holds right now. */
  current: string;
  /** What we would put there. Empty when we have nothing to offer. */
  proposed: string;
  status: FieldStatus;
  /** Which part of the form this belongs to, for the group headings. */
  group: string;
  /** Why it needs the user, when it does. */
  note?: string;
  /** How many controls this one row stands for, when more than one. */
  count?: number;
}

export interface FormPlan {
  fields: PlannedField[];
  hostname: string;
}

/**
 * The frame a field lives in, packed into its id.
 *
 * The content script runs in every frame, and a message sent to the tab
 * without a frameId reaches all of them and keeps whichever answers first. An
 * application embedded in an iframe therefore had its plan answered by the top
 * frame, which has no form: the panel reported no fields, and inserting an
 * answer reported failure while the right frame quietly did the work.
 */
export function withFrame(frameId: number | null, id: string): string {
  return `${frameId ?? 't'}::${id}`;
}

export function frameOf(id: string): number | null {
  // An id with no separator predates this scheme, or came from the top frame.
  // Either way it is the top frame, not NaN.
  if (!id.includes('::')) return null;
  const head = id.slice(0, id.indexOf('::'));
  const frame = Number(head);
  return head === 't' || Number.isNaN(frame) ? null : frame;
}

export function localId(id: string): string {
  const index = id.indexOf('::');
  return index === -1 ? id : id.slice(index + 2);
}

export interface Tally {
  total: number;
  ready: number;
  you: number;
  ai: number;
}

/**
 * The state of one field.
 *
 * `done` before `ready` matters: re-running on a part-filled form should show
 * what is already correct rather than proposing to write it again.
 */
export function statusFor(input: {
  current: string;
  proposed: string;
  path: string | null;
  isQuestion?: boolean;
  optional?: boolean;
}): FieldStatus {
  const current = input.current.trim();
  const proposed = input.proposed.trim();

  if (proposed && current === proposed) return 'done';
  if (proposed) return 'ready';
  // An open question with no stored answer is what drafting is for. A short
  // factual field with no stored answer is not - it is something only the user
  // knows, and asking a model to invent it is how wrong answers get submitted.
  if (input.isQuestion) return 'ai';
  if (input.optional && !current) return 'skip';
  return 'you';
}

/** The count strip. `done` is deliberately not shown: it is the absence of work. */
export function tally(fields: PlannedField[]): Tally {
  return {
    total: fields.length,
    ready: fields.filter((f) => f.status === 'ready' || f.status === 'done').length,
    you: fields.filter((f) => f.status === 'you').length,
    ai: fields.filter((f) => f.status === 'ai').length,
  };
}

/** Only these get written. Everything else is either done or not ours to answer. */
export function writable(fields: PlannedField[]): PlannedField[] {
  return fields.filter((field) => field.status === 'ready');
}

/**
 * Groups in the order the form presents them, with their fields in order.
 *
 * A Map preserves insertion order, so the panel mirrors the page rather than
 * imposing an alphabet on it. Reading the panel top to bottom should be reading
 * the form top to bottom.
 */
export function byGroup(fields: PlannedField[]): Array<[string, PlannedField[]]> {
  const groups = new Map<string, PlannedField[]>();
  for (const field of fields) {
    const list = groups.get(field.group) ?? [];
    list.push(field);
    groups.set(field.group, list);
  }
  return [...groups.entries()];
}

/**
 * A short machine name from the form's own label.
 *
 * The mono column is a fixed width, so this has to stay legible when clipped:
 * "earliest_start" reads at a glance where "What is your earliest possible
 * start date" does not.
 */
export function shortName(label: string, path: string | null): string {
  if (path) return path.split('.').pop() ?? path;
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join('_') || 'field'
  );
}
