import { STATUSES, type ApplicationRecord, type ApplicationStatus } from './application-record';

/**
 * What the dashboard may ask the extension, and what it gets back.
 *
 * The dashboard is a web page on someone else's host. It holds no data: it asks
 * for records and renders them. That makes this file the boundary, and the
 * boundary is built as an allowlist — the response is assembled field by field
 * from the record, never spread from an object that might carry more. A
 * redaction list would have to be updated every time a field is added; an
 * allowlist fails closed.
 *
 * Document bytes are sent only for a single application, and only when asked.
 * A list of fifty applications with two .docx files each would be four
 * megabytes through a message channel that serialises to JSON.
 */

export const ALLOWED_ORIGINS = [
  'https://applyflow-dashboard.vercel.app',
  'http://localhost:5174',
];

export function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.includes(origin);
}

/** A document in a list: named, but not carried. */
export interface DocumentSummary {
  filename: string;
  savedAt: number;
}

/** A document in a detail view: carried, base64 because the channel is JSON. */
export interface DocumentPayload extends DocumentSummary {
  base64: string;
}

export interface TransferableRecord {
  id: string;
  appliedAt: number;
  company: string;
  title: string;
  url: string;
  hostname: string;
  status: ApplicationStatus;
  filledCount: number;
  invalidCount: number;
  questionsDrafted: number;
  documentsAttached: number;
  jobDescription: string;
  matchScore: number | null;
  gapCovered: string[];
  gapMissing: string[];
  variantIds: string[];
  estimatedFigures: string[];
  requestsSpent: number;
  resume: DocumentSummary | null;
  coverLetter: DocumentSummary | null;
}

export interface DetailedRecord extends Omit<TransferableRecord, 'resume' | 'coverLetter'> {
  resume: DocumentPayload | null;
  coverLetter: DocumentPayload | null;
}

export type DashboardRequest =
  | { type: 'list' }
  | { type: 'get'; id: string }
  | { type: 'set-status'; id: string; status: ApplicationStatus };

/**
 * One success shape rather than three.
 *
 * Three members all carrying `ok: true` cannot be narrowed by `ok` alone, so
 * every caller would need `'records' in response` to get at anything. Optional
 * fields on one member narrow cleanly and read the same at the call site.
 */
export type DashboardResponse =
  | { ok: true; records?: TransferableRecord[]; record?: DetailedRecord | null }
  | { ok: false; error: string };

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked: String.fromCharCode(...bytes) overflows the call stack on a file
  // of any real size.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Field by field, so nothing that is not listed here can ever be sent. */
export function toTransferable(record: ApplicationRecord): TransferableRecord {
  return {
    id: record.id,
    appliedAt: record.appliedAt,
    company: record.company,
    title: record.title,
    url: record.url,
    hostname: record.hostname,
    status: record.status,
    filledCount: record.filledCount,
    invalidCount: record.invalidCount,
    questionsDrafted: record.questionsDrafted,
    documentsAttached: record.documentsAttached,
    jobDescription: record.jobDescription,
    matchScore: record.matchScore,
    gapCovered: record.gapCovered,
    gapMissing: record.gapMissing,
    variantIds: record.variantIds,
    estimatedFigures: record.estimatedFigures,
    requestsSpent: record.requestsSpent,
    resume: record.resume ? { filename: record.resume.filename, savedAt: record.resume.savedAt } : null,
    coverLetter: record.coverLetter
      ? { filename: record.coverLetter.filename, savedAt: record.coverLetter.savedAt }
      : null,
  };
}

function toDetailed(record: ApplicationRecord): DetailedRecord {
  const summary = toTransferable(record);
  return {
    ...summary,
    resume: record.resume
      ? { ...summary.resume!, base64: base64(record.resume.bytes) }
      : null,
    coverLetter: record.coverLetter
      ? { ...summary.coverLetter!, base64: base64(record.coverLetter.bytes) }
      : null,
  };
}

export interface BridgeDeps {
  list: () => Promise<ApplicationRecord[]>;
  get: (id: string) => Promise<ApplicationRecord | null>;
  patch: (id: string, patch: Partial<ApplicationRecord>) => Promise<void>;
}

export async function handleDashboardRequest(
  request: DashboardRequest,
  deps: BridgeDeps
): Promise<DashboardResponse> {
  switch (request?.type) {
    case 'list':
      return { ok: true, records: (await deps.list()).map(toTransferable) };

    case 'get': {
      const record = await deps.get(request.id);
      return { ok: true, record: record ? toDetailed(record) : null };
    }

    case 'set-status': {
      // The only write the dashboard is allowed. Everything else it shows is
      // produced by the extension while applying.
      if (!STATUSES.includes(request.status)) return { ok: false, error: 'Unknown status.' };
      await deps.patch(request.id, { status: request.status });
      return { ok: true };
    }

    default:
      return { ok: false, error: 'Unknown request.' };
  }
}
