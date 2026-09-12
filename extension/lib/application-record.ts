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
