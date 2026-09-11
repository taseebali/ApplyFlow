/**
 * The dashboard's only link to its data.
 *
 * There is no server and no database. Every record is held by the extension on
 * this machine, and this page asks for it over `chrome.runtime.sendMessage`.
 * That is the whole reason the dashboard can be a public URL without anything
 * of yours being on it: open it in a browser without the extension and it shows
 * nothing, because there is nothing there to show.
 *
 * The types below mirror lib/dashboard-bridge.ts in the extension. They are
 * copied rather than imported because this is a separate npm project; if you
 * change one, change both.
 */

/** Set by Task 6's pinned key. */
export const EXTENSION_ID = 'jlfojkgndajebhpbcegdimapokhjpdik';

export type ApplicationStatus = 'applied' | 'replied' | 'interview' | 'rejected' | 'offer';
export const STATUSES: ApplicationStatus[] = ['applied', 'replied', 'interview', 'rejected', 'offer'];

export interface DocumentSummary {
  filename: string;
  savedAt: number;
}
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

export type DashboardResponse =
  | { ok: true; records?: TransferableRecord[]; record?: DetailedRecord | null }
  | { ok: false; error: string };

export class NoExtensionError extends Error {}

export function askExtension(request: DashboardRequest): Promise<DashboardResponse> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new NoExtensionError('ApplyFlow is not installed in this browser.'));
      return;
    }
    chrome.runtime.sendMessage(EXTENSION_ID, request, (response?: DashboardResponse) => {
      // An uninstalled or disabled extension sets lastError rather than
      // throwing, and reading it is what stops Chrome logging it as unchecked.
      if (chrome.runtime.lastError || !response) {
        reject(new NoExtensionError('ApplyFlow did not answer. Is it installed and enabled?'));
        return;
      }
      resolve(response);
    });
  });
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
