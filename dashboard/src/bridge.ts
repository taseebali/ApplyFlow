/**
 * The dashboard's only link to its data.
 *
 * There is no server and no database. Every record is held by the extension on
 * this machine, and this page asks for it over `chrome.runtime.sendMessage`.
 * That is the whole reason the dashboard can be a public URL without anything
 * of yours being on it: open it in a browser without the extension and it shows
 * nothing, because there is nothing there to show.
 *
 * This build is served from inside the extension itself, at
 * chrome-extension://<id>/dashboard/index.html, so the message is an ordinary
 * same-extension one. There is no hosted copy and no origin allowlist: the
 * extension answers no outside page at all, in any build.
 *
 * The types below mirror lib/dashboard-bridge.ts in the extension. They are
 * copied rather than imported because this is a separate npm project; if you
 * change one, change both. `npm run check:mirror` fails when they drift.
 */

export type ApplicationStatus = 'applied' | 'replied' | 'interview' | 'rejected' | 'offer';
export const STATUSES: ApplicationStatus[] = ['applied', 'replied', 'interview', 'rejected', 'offer'];

export type Priority = 'none' | 'low' | 'medium' | 'high';
export const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high'];

/** The fields a person edits after applying — the extension's whole write surface. */
export interface EditableProperties {
  status: ApplicationStatus;
  priority: Priority;
  tags: string[];
  nextAction: string;
  nextActionAt: number | null;
  salary: string;
}

export interface DocumentSummary {
  filename: string;
  savedAt: number;
}
export interface DocumentPayload extends DocumentSummary {
  base64: string;
}

export interface TransferableRecord extends EditableProperties {
  id: string;
  appliedAt: number;
  company: string;
  title: string;
  url: string;
  hostname: string;
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
  | { type: 'set-properties'; id: string; properties: Partial<EditableProperties> };

export type DashboardResponse =
  | { ok: true; records?: TransferableRecord[]; record?: DetailedRecord | null }
  | { ok: false; error: string };

/** Anything past `applied` is a reply, however it went. */
const REPLIED: ApplicationStatus[] = ['replied', 'interview', 'rejected', 'offer'];

export function hasReplied(status: ApplicationStatus): boolean {
  return REPLIED.includes(status);
}

export interface WordingOutcome {
  variantId: string;
  sent: number;
  replied: number;
}

/**
 * How each bullet has done, over the records already fetched.
 *
 * The whole reason `variantIds` is recorded, and the question the tool exists
 * to answer: with enough applications this says which framing of a piece of
 * work gets answered. Mirrors `wordingOutcomes` in the extension's
 * lib/application-record.ts, copied for the same reason the types above are —
 * change one, change both.
 */
export function wordingOutcomes(records: TransferableRecord[]): WordingOutcome[] {
  const sent = new Map<string, number>();
  const replied = new Map<string, number>();

  for (const r of records) {
    const isReply = hasReplied(r.status);
    for (const id of r.variantIds) {
      sent.set(id, (sent.get(id) ?? 0) + 1);
      if (isReply) replied.set(id, (replied.get(id) ?? 0) + 1);
    }
  }

  return [...sent.entries()]
    .map(([variantId, count]) => ({ variantId, sent: count, replied: replied.get(variantId) ?? 0 }))
    // Replies first, not reply rate: one bullet sent once and answered once
    // would otherwise outrank one answered five times in nine.
    .sort((a, b) => b.replied - a.replied || b.sent - a.sent);
}

/*
 * ---- reaching the extension ----
 *
 * A bare "it did not work" is the least useful thing this page can say, and for
 * a page whose entire content lives somewhere else it is also the most likely
 * thing to have to say. Each way it can fail asks something different of the
 * reader, so each is its own state rather than one error string.
 */

export type ConnectionState =
  /** No answer yet. */
  | { kind: 'checking' }
  | { kind: 'ready' }
  /** Not a Chromium browser, or the page was opened straight off disk. */
  | { kind: 'no-runtime' }
  /** Nothing answered: the worker is gone, or this page is being served from
   *  somewhere that is not the extension. */
  | { kind: 'not-installed' }
  /** It began answering and then stopped. A worker that died mid-request. */
  | { kind: 'unreachable' };

export type FailedState = Exclude<ConnectionState, { kind: 'ready' } | { kind: 'checking' }>;

export class BridgeError extends Error {
  constructor(readonly state: FailedState) {
    super(state.kind);
    this.name = 'BridgeError';
  }
}

/** Long enough for a cold service worker to start, short enough not to read as a hang. */
const TIMEOUT_MS = 6_000;

/**
 * Whether a `lastError` means nothing is listening, as opposed to a real
 * failure. Chrome has no error codes here, only this sentence, and it reads
 * the same whether the extension is missing, disabled, or a release build that
 * lists no external page — which is why the state it produces names all three.
 */
function noReceiver(message: string | undefined): boolean {
  return /receiving end does not exist|could not establish connection|invalid extension id/i.test(message ?? '');
}

/**
 * Whether this page is being served from inside the extension.
 *
 * True whenever it is doing its job. False on the Vite dev server, which is
 * still useful for working on the layout — every connection state renders
 * there — but cannot reach the extension, by design.
 */
export function isExtensionPage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime?.id === 'string' &&
    // Guarded: this module is unit-tested outside a browser, where there is no
    // `location` at all and reading it would throw rather than answer false.
    typeof location !== 'undefined' &&
    location.protocol === 'chrome-extension:'
  );
}

export function askExtension(request: DashboardRequest): Promise<DashboardResponse> {
  return new Promise((resolve, reject) => {
    if (!isExtensionPage() || !chrome.runtime?.sendMessage) {
      reject(new BridgeError({ kind: 'no-runtime' }));
      return;
    }

    // `sendMessage` normally always calls back, with `lastError` set when it
    // could not be delivered. A worker killed mid-request is the case where it
    // does not, and without this the page sits on "Reading…" forever.
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new BridgeError({ kind: 'unreachable' }));
    }, TIMEOUT_MS);

    const reply = (response?: DashboardResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // Reading `lastError` is also what stops Chrome logging it as unchecked.
      const failure = chrome.runtime.lastError?.message;
      if (failure || !response) {
        reject(new BridgeError(noReceiver(failure) ? { kind: 'not-installed' } : { kind: 'unreachable' }));
        return;
      }
      resolve(response);
    };

    // No extension id: inside the extension it is implicit, and naming our own
    // id would route to `onMessageExternal`, which never fires for the
    // extension's own pages and no longer exists.
    chrome.runtime.sendMessage({ ...request, __dashboard: true }, reply);
  });
}

export function stateFor(error: unknown): FailedState {
  return error instanceof BridgeError ? error.state : { kind: 'unreachable' };
}

/** Turns a base64 document back into something the browser will download. */
export function toBlobUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  );
}
