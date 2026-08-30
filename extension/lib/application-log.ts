/**
 * A local record of every application put through ApplyFlow.
 *
 * Two gaps this closes. Tracking previously required Notion, so skipping it
 * meant no tracking at all. And nothing answered the question the whole tool
 * exists to serve — is this actually helping? — because no run left a trace.
 *
 * Stored locally like everything else, and exportable as CSV so it is not a
 * one-way street into another proprietary format.
 */

const LOG_KEY = 'application-log';

/** Bounded: `storage.local` is shared and capped, and old entries age out of usefulness. */
const MAX_ENTRIES = 500;

export interface ApplicationEntry {
  id: string;
  appliedAt: number;
  company: string;
  title: string;
  url: string;
  hostname: string;
  filledCount: number;
  /** Values written that the form rejected — worth knowing which sites do this. */
  invalidCount: number;
  questionsDrafted: number;
  documentsAttached: number;
  loggedToNotion: boolean;
}

export async function getApplications(): Promise<ApplicationEntry[]> {
  const stored = await browser.storage.local.get(LOG_KEY);
  return (stored[LOG_KEY] as ApplicationEntry[] | undefined) ?? [];
}

export async function recordApplication(
  entry: Omit<ApplicationEntry, 'id' | 'appliedAt'>
): Promise<ApplicationEntry> {
  const full: ApplicationEntry = { ...entry, id: crypto.randomUUID(), appliedAt: Date.now() };
  const entries = [full, ...(await getApplications())].slice(0, MAX_ENTRIES);
  try {
    await browser.storage.local.set({ [LOG_KEY]: entries });
  } catch {
    // History is a convenience; never let it break an application.
  }
  return full;
}

/**
 * Fills in what happened after the fill. An application is recorded when the
 * page is filled, but drafting, attaching and logging happen afterwards — so
 * without this those counts stayed at zero forever and the history reported
 * work it had actually done as nothing.
 */
export async function updateApplication(
  id: string,
  patch: Partial<Omit<ApplicationEntry, 'id' | 'appliedAt'>>
): Promise<void> {
  const entries = await getApplications();
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) return;

  entries[index] = { ...entries[index]!, ...patch };
  try {
    await browser.storage.local.set({ [LOG_KEY]: entries });
  } catch {
    // History is a convenience; never let it break an application.
  }
}

export async function clearApplications(): Promise<void> {
  await browser.storage.local.remove(LOG_KEY);
}

export interface ApplicationStats {
  total: number;
  last30Days: number;
  fieldsFilled: number;
  questionsDrafted: number;
  /** Sites where a written value was rejected, worst first. */
  troublesomeSites: Array<{ hostname: string; invalid: number }>;
}

export function summarize(entries: ApplicationEntry[], now = Date.now()): ApplicationStats {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const byHost = new Map<string, number>();

  for (const entry of entries) {
    if (entry.invalidCount > 0) {
      byHost.set(entry.hostname, (byHost.get(entry.hostname) ?? 0) + entry.invalidCount);
    }
  }

  return {
    total: entries.length,
    last30Days: entries.filter((e) => e.appliedAt >= cutoff).length,
    fieldsFilled: entries.reduce((sum, e) => sum + e.filledCount, 0),
    questionsDrafted: entries.reduce((sum, e) => sum + e.questionsDrafted, 0),
    troublesomeSites: [...byHost.entries()]
      .map(([hostname, invalid]) => ({ hostname, invalid }))
      .sort((a, b) => b.invalid - a.invalid)
      .slice(0, 5),
  };
}

const CSV_COLUMNS: Array<keyof ApplicationEntry> = [
  'appliedAt',
  'company',
  'title',
  'url',
  'hostname',
  'filledCount',
  'invalidCount',
  'questionsDrafted',
  'documentsAttached',
  'loggedToNotion',
];

/** A field starting with =, +, - or @ is executed as a formula by spreadsheets. */
function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toCsv(entries: ApplicationEntry[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = entries.map((entry) =>
    CSV_COLUMNS.map((column) =>
      csvCell(column === 'appliedAt' ? new Date(entry.appliedAt).toISOString() : entry[column])
    ).join(',')
  );
  return [header, ...rows].join('\n');
}
