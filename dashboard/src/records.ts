/**
 * Everything the views do to a list of records before drawing it.
 *
 * Kept out of the components on purpose: filtering, sorting and grouping are
 * the only logic on this page that can be wrong in a way nobody notices, and
 * none of it needs a DOM to test.
 */
import { hasReplied, type ApplicationStatus, type Priority, type TransferableRecord } from './bridge';

export type ViewKind = 'table' | 'board' | 'gallery';

export type SortKey = 'appliedAt' | 'company' | 'title' | 'status' | 'priority' | 'matchScore' | 'nextActionAt';
export type SortDirection = 'asc' | 'desc';

export interface Query {
  search: string;
  statuses: ApplicationStatus[];
  priorities: Priority[];
  tags: string[];
  sort: SortKey;
  direction: SortDirection;
}

export const EMPTY_QUERY: Query = {
  search: '',
  statuses: [],
  priorities: [],
  tags: [],
  sort: 'appliedAt',
  direction: 'desc',
};

/** Statuses in pipeline order, which is the order a board reads left to right. */
export const BOARD_ORDER: ApplicationStatus[] = ['applied', 'replied', 'interview', 'offer', 'rejected'];

/** Least to most, so a numeric comparison means what the word means. */
const PRIORITY_RANK: Record<Priority, number> = { none: 0, low: 1, medium: 2, high: 3 };
const STATUS_RANK: Record<ApplicationStatus, number> = {
  applied: 0,
  replied: 1,
  interview: 2,
  offer: 3,
  rejected: 4,
};

/**
 * Every part of a record a search should reach.
 *
 * The job description is in here deliberately: "who did I apply to that wanted
 * Rust" is the question a tracker is for, and it is the only field that can
 * answer it.
 */
function haystack(record: TransferableRecord): string {
  return [
    record.company,
    record.title,
    record.hostname,
    record.nextAction,
    record.salary,
    record.tags.join(' '),
    record.jobDescription,
  ]
    .join(' ')
    .toLowerCase();
}

/** Each word must appear somewhere, in any order — not the whole phrase. */
export function matchesSearch(record: TransferableRecord, search: string): boolean {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = haystack(record);
  return terms.every((term) => text.includes(term));
}

export function matchesFilters(record: TransferableRecord, query: Query): boolean {
  if (query.statuses.length > 0 && !query.statuses.includes(record.status)) return false;
  if (query.priorities.length > 0 && !query.priorities.includes(record.priority)) return false;
  // Tags are AND, not OR: narrowing is the point, and two selected tags that
  // widened the result would be the opposite of what the click looked like.
  if (query.tags.length > 0 && !query.tags.every((tag) => record.tags.includes(tag))) return false;
  return matchesSearch(record, query.search);
}

function compare(a: TransferableRecord, b: TransferableRecord, key: SortKey): number {
  switch (key) {
    case 'company':
      return a.company.localeCompare(b.company);
    case 'title':
      return a.title.localeCompare(b.title);
    case 'status':
      return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    case 'priority':
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    case 'matchScore':
      // Unscored sorts as lowest rather than as zero: a record with no score
      // is not a bad match, and it must not sit among the genuinely bad ones.
      return (a.matchScore ?? -1) - (b.matchScore ?? -1);
    case 'nextActionAt':
      // No date sorts last in both directions — something with nothing planned
      // is never the most urgent thing on the page.
      if (a.nextActionAt === b.nextActionAt) return 0;
      if (a.nextActionAt === null) return 1;
      if (b.nextActionAt === null) return -1;
      return a.nextActionAt - b.nextActionAt;
    case 'appliedAt':
      return a.appliedAt - b.appliedAt;
  }
}

export function applyQuery(records: TransferableRecord[], query: Query): TransferableRecord[] {
  const filtered = records.filter((record) => matchesFilters(record, query));
  const sign = query.direction === 'asc' ? 1 : -1;

  return [...filtered].sort((a, b) => {
    const primary = compare(a, b, query.sort) * sign;
    // A stable tiebreak, so two records that sort equally never swap places
    // between renders and make the list look like it moved on its own.
    return primary !== 0 ? primary : b.appliedAt - a.appliedAt;
  });
}

/**
 * `nextActionAt` sorts ascending under every direction, because "soonest" is
 * what a date column means. Everything else takes the direction it was given.
 */
export function defaultDirectionFor(key: SortKey): SortDirection {
  return key === 'company' || key === 'title' || key === 'nextActionAt' ? 'asc' : 'desc';
}

export function groupByStatus(records: TransferableRecord[]): Array<{ status: ApplicationStatus; records: TransferableRecord[] }> {
  return BOARD_ORDER.map((status) => ({ status, records: records.filter((r) => r.status === status) }));
}

/** Every tag in use, most used first, so the filter bar leads with the useful ones. */
export function allTags(records: TransferableRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const tag of record.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

export interface Summary {
  total: number;
  replied: number;
  /** Replies as a percentage, or null when nothing has been sent. */
  replyRate: number | null;
  interviewing: number;
  last30Days: number;
  /** Planned actions whose date has passed. */
  overdue: number;
  /** Mean match score over the records that have one. */
  averageScore: number | null;
}

export function summarize(records: TransferableRecord[], now = Date.now()): Summary {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const replied = records.filter((r) => hasReplied(r.status)).length;
  const scored = records.filter((r) => r.matchScore !== null);

  return {
    total: records.length,
    replied,
    replyRate: records.length === 0 ? null : Math.round((replied / records.length) * 100),
    interviewing: records.filter((r) => r.status === 'interview').length,
    last30Days: records.filter((r) => r.appliedAt >= cutoff).length,
    // A rejected application is closed, so a date left on it is not overdue.
    overdue: records.filter(
      (r) => r.nextActionAt !== null && r.nextActionAt < now && r.status !== 'rejected' && r.status !== 'offer'
    ).length,
    averageScore:
      scored.length === 0
        ? null
        : Math.round(scored.reduce((sum, r) => sum + (r.matchScore ?? 0), 0) / scored.length),
  };
}

/** How many applications went out in each of the last `weeks` weeks, oldest first. */
export function weeklyVolume(records: TransferableRecord[], weeks = 12, now = Date.now()): number[] {
  const week = 7 * 24 * 60 * 60 * 1000;
  const buckets = new Array<number>(weeks).fill(0);

  for (const record of records) {
    const age = now - record.appliedAt;
    if (age < 0) continue;
    const index = weeks - 1 - Math.floor(age / week);
    if (index >= 0) buckets[index] += 1;
  }
  return buckets;
}

/* ---- dates, as a date input speaks them ---- */

export function toDateInput(at: number | null): string {
  if (at === null) return '';
  // `toISOString` is UTC, which shifts the day for anyone east or west of it.
  // Building the string from the local parts keeps the date the user picked.
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateInput(value: string): number | null {
  if (!value) return null;
  // Parsed as local midnight rather than `new Date(value)`, which reads a bare
  // date as UTC and lands on the previous day for anyone west of Greenwich.
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day).getTime();
}
