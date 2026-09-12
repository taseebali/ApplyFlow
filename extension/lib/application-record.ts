/**
 * One application, in full.
 *
 * The old log stored counts: how many fields were filled, how many questions
 * got drafted. It could not answer the question the tool exists to serve —
 * which wording actually gets replies — because it never recorded what was
 * sent. This does, and keeps both finished documents with it.
 */

/** What happened after applying. Set by hand; nothing else can know it. */
export type ApplicationStatus = 'applied' | 'replied' | 'interview' | 'rejected' | 'offer';

export const STATUSES: ApplicationStatus[] = ['applied', 'replied', 'interview', 'rejected', 'offer'];

/** Anything past `applied` is a reply, however it went. */
const REPLIED: ApplicationStatus[] = ['replied', 'interview', 'rejected', 'offer'];

/**
 * A document as it was sent.
 *
 * Bytes rather than a filename, so the record survives the documents folder
 * being cleaned, moved, or opened on another machine. Roughly 30-60KB each,
 * which IndexedDB carries without complaint and `storage.local` would not.
 */
export interface StoredDocument {
  filename: string;
  /** The .docx itself. */
  bytes: ArrayBuffer;
  savedAt: number;
}

export interface ApplicationRecord {
  id: string;
  appliedAt: number;
  company: string;
  title: string;
  url: string;
  hostname: string;
  status: ApplicationStatus;

  filledCount: number;
  /** Values written that the form rejected — worth knowing which sites do this. */
  invalidCount: number;
  questionsDrafted: number;
  documentsAttached: number;

  /** The posting itself, so the record stands alone once the page is gone. */
  jobDescription: string;
  matchScore: number | null;
  gapCovered: string[];
  gapMissing: string[];
  /** Bank variant ids of the exact bullets that went out. */
  variantIds: string[];
  /** Figures the model estimated rather than read, as shown in review. */
  estimatedFigures: string[];
  /** Model requests this application cost. */
  requestsSpent: number;

  resume: StoredDocument | null;
  coverLetter: StoredDocument | null;
}

export function emptyRecord(
  seed: Pick<ApplicationRecord, 'company' | 'title' | 'url' | 'hostname'>
): ApplicationRecord {
  return {
    id: crypto.randomUUID(),
    appliedAt: Date.now(),
    status: 'applied',
    filledCount: 0,
    invalidCount: 0,
    questionsDrafted: 0,
    documentsAttached: 0,
    jobDescription: '',
    matchScore: null,
    gapCovered: [],
    gapMissing: [],
    variantIds: [],
    estimatedFigures: [],
    requestsSpent: 0,
    resume: null,
    coverLetter: null,
    ...seed,
  };
}

/** One frame's answer to a fill, as far as the record is concerned. */
export interface FillOutcome {
  hostname: string;
  filledCount: number;
  /** Values the form rejected. Only the count is kept; the labels are the panel's. */
  invalid: unknown[];
}

/**
 * Origin and path, so a URL that picked up a tracking parameter between
 * visits — `?utm_source=`, `?gh_src=`, a Lever referral tag — still counts as
 * the same posting. The posting id itself lives in the path on every ATS this
 * extension supports (a board slug, a UUID); query strings there are
 * campaign noise, not identity.
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}

/**
 * The record for a posting after a fill run.
 *
 * A second fill of the same posting must land on the record that posting
 * already has. A fresh one would double every total and count the same
 * bullets twice in `wordingOutcomes` — and orphan the first record, which by
 * then holds the documents and the score. Counts add rather than replace,
 * because an application split over several pages or frames is one
 * application filled in several runs.
 *
 * `existing` is whatever the caller's tab state currently points at — not
 * proof it's the same posting. An iframe-embedded application or a URL
 * `isJobUrl` fails to recognise can leave that state uncleared while the tab
 * has moved on to a second posting, so this checks for itself: an `existing`
 * record filed under a different URL is a different application, whatever
 * the caller thought it was tracking. Empty URLs (a posting page that could
 * not be read yet) never count as a mismatch, only two different non-empty
 * ones do.
 */
export function recordForFill(
  posting: Pick<ApplicationRecord, 'company' | 'title' | 'url'>,
  outcomes: FillOutcome[],
  existing: ApplicationRecord | null = null
): ApplicationRecord {
  const samePosting =
    existing !== null &&
    (existing.url === '' || posting.url === '' || normalizeUrl(existing.url) === normalizeUrl(posting.url));

  const base = samePosting
    ? (existing as ApplicationRecord)
    : emptyRecord({ ...posting, hostname: outcomes[0]?.hostname ?? '' });
  return {
    ...base,
    // The posting is often only readable on one page of a multi-step flow, so
    // a later run can know a company or title that the first one could not.
    company: base.company || posting.company,
    title: base.title || posting.title,
    url: base.url || posting.url,
    filledCount: base.filledCount + outcomes.reduce((sum, o) => sum + o.filledCount, 0),
    invalidCount: base.invalidCount + outcomes.reduce((sum, o) => sum + o.invalid.length, 0),
  };
}

export interface ApplicationStats {
  total: number;
  last30Days: number;
  replied: number;
  fieldsFilled: number;
  questionsDrafted: number;
  /** Sites where a written value was rejected, worst first. */
  troublesomeSites: Array<{ hostname: string; invalid: number }>;
}

export function summarize(records: ApplicationRecord[], now = Date.now()): ApplicationStats {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const byHost = new Map<string, number>();

  for (const r of records) {
    if (r.invalidCount > 0) byHost.set(r.hostname, (byHost.get(r.hostname) ?? 0) + r.invalidCount);
  }

  return {
    total: records.length,
    last30Days: records.filter((r) => r.appliedAt >= cutoff).length,
    replied: records.filter((r) => REPLIED.includes(r.status)).length,
    fieldsFilled: records.reduce((sum, r) => sum + r.filledCount, 0),
    questionsDrafted: records.reduce((sum, r) => sum + r.questionsDrafted, 0),
    troublesomeSites: [...byHost.entries()]
      .map(([hostname, invalid]) => ({ hostname, invalid }))
      .sort((a, b) => b.invalid - a.invalid)
      .slice(0, 5),
  };
}

export interface WordingOutcome {
  variantId: string;
  sent: number;
  replied: number;
}

/**
 * How each bullet has done.
 *
 * The whole reason for recording `variantIds`. With enough applications this
 * says which framing of a piece of work gets answered — something no amount of
 * counting filled fields could ever show.
 *
 * The dashboard renders this, over the records it has already fetched, from
 * its own copy in dashboard/src/bridge.ts — copied for the same reason the
 * transfer types are, since it is a separate npm project. This is the tested
 * one: change one, change both.
 */
export function wordingOutcomes(records: ApplicationRecord[]): WordingOutcome[] {
  const sent = new Map<string, number>();
  const replied = new Map<string, number>();

  for (const r of records) {
    const isReply = REPLIED.includes(r.status);
    for (const id of r.variantIds) {
      sent.set(id, (sent.get(id) ?? 0) + 1);
      if (isReply) replied.set(id, (replied.get(id) ?? 0) + 1);
    }
  }

  return [...sent.entries()]
    .map(([variantId, count]) => ({ variantId, sent: count, replied: replied.get(variantId) ?? 0 }))
    .sort((a, b) => b.replied - a.replied || b.sent - a.sent);
}

const CSV_COLUMNS: Array<keyof ApplicationRecord> = [
  'appliedAt',
  'company',
  'title',
  'url',
  'hostname',
  'status',
  'matchScore',
  'filledCount',
  'invalidCount',
  'questionsDrafted',
  'documentsAttached',
];

/** A field starting with =, +, - or @ is executed as a formula by spreadsheets. */
function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * A summary, not a dump: no `jobDescription` or document bytes, which would
 * make a row unreadable rather than useful. `estimatedFigures` becomes a
 * count for the same reason — the figures themselves belong in the record,
 * not a spreadsheet cell.
 */
export function toCsv(records: ApplicationRecord[]): string {
  const header = [...CSV_COLUMNS, 'estimatedFigures'].join(',');
  const rows = records.map((record) =>
    [
      ...CSV_COLUMNS.map((column) =>
        csvCell(column === 'appliedAt' ? new Date(record.appliedAt).toISOString() : record[column])
      ),
      csvCell(record.estimatedFigures.length),
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * A saved file, ready to store.
 *
 * `Blob.arrayBuffer()` is missing in jsdom, where the tests run, so the
 * FileReader path is the one that works in both places — the same reason
 * `resume-text.ts` reads files the way it does.
 */
export async function documentFromBlob(
  filename: string,
  blob: Blob,
  savedAt = Date.now()
): Promise<StoredDocument> {
  const bytes = await (typeof blob.arrayBuffer === 'function'
    ? blob.arrayBuffer()
    : new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      }));
  return { filename, bytes, savedAt };
}
