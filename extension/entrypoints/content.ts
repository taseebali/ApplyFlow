import { fillFields, fillRadioGroups, setNativeFieldValue } from '@/lib/filler';
import {
  findUnrecognizedFields,
  matchFields,
  matchFileInputs,
  matchRadioGroups,
  type FileInputMatch,
  type UnrecognizedField,
} from '@/lib/field-matcher';
import { getOverridesForHost } from '@/lib/field-overrides';
import { getProfile } from '@/lib/storage';
import { scrapeCompanyName } from '@/lib/company-scraper';
import { scrapeJobDescription, scrapeJobTitle } from '@/lib/jd-scraper';
import type { DocumentKind } from '@/lib/document-matcher';
import { detectQuestions } from '@/lib/question-detector';

export interface FillPageMessage {
  type: 'fill-page';
}
export interface FillPageResponse {
  filledCount: number;
  unmatchedCount: number;
  unmatchedLabels: string[];
  /** Fields we could fill but could not identify — the panel offers to learn these. */
  unrecognized: UnrecognizedField[];
  hostname: string;
}

export interface GetJobInfoMessage {
  type: 'get-job-info';
}
export interface GetJobInfoResponse {
  companyName: string | null;
  jobTitle: string | null;
  jobDescription: string | null;
  jobUrl: string;
}

export interface AttachDocumentsMessage {
  type: 'attach-documents';
  files: Array<{
    kind: DocumentKind;
    name: string;
    mimeType: string;
    // Raw bytes rather than a File/Blob: extension messaging's structured
    // clone does not reliably preserve File/Blob objects across the
    // side-panel-to-content-script boundary, but ArrayBuffer transfers fine.
    data: ArrayBuffer;
  }>;
}
export interface AttachDocumentsResponse {
  attached: Partial<Record<DocumentKind, boolean>>;
}

export interface GetQuestionsMessage {
  type: 'get-questions';
}
export interface GetQuestionsResponse {
  questions: Array<{ id: string; question: string }>;
  jobDescription: string | null;
}

export interface InsertAnswerMessage {
  type: 'insert-answer';
  id: string;
  text: string;
}
export interface InsertAnswerResponse {
  inserted: boolean;
}

type IncomingMessage =
  | FillPageMessage
  | GetJobInfoMessage
  | AttachDocumentsMessage
  | GetQuestionsMessage
  | InsertAnswerMessage;

// Detected question elements can't cross the message boundary, so they're kept
// here and referenced by id when the side panel asks to insert an answer.
const detectedQuestions = new Map<string, HTMLTextAreaElement | HTMLInputElement>();

/**
 * Many ATSs don't have dedicated resume/cover-letter fields at all — just one
 * generic "Additional Documents" upload. Prefer a dedicated field for each
 * kind, but fall back to the generic one when it doesn't exist. If resume and
 * cover letter end up sharing the same field, both files need to land in a
 * single DataTransfer — setting `.files` twice would overwrite the first.
 */
function attachDocuments(entries: Array<{ kind: DocumentKind; file: File }>): Partial<Record<DocumentKind, boolean>> {
  const matches = matchFileInputs(document);
  const dedicated: Record<DocumentKind, FileInputMatch | undefined> = {
    resume: matches.find((m) => m.kind === 'resume'),
    coverLetter: matches.find((m) => m.kind === 'coverLetter'),
  };
  const fallback = matches.find((m) => m.kind === 'additional');

  const result: Partial<Record<DocumentKind, boolean>> = {};
  const filesByElement = new Map<HTMLInputElement, File[]>();

  for (const entry of entries) {
    const target = dedicated[entry.kind] ?? fallback;
    if (!target) {
      result[entry.kind] = false;
      continue;
    }
    const list = filesByElement.get(target.element) ?? [];
    list.push(entry.file);
    filesByElement.set(target.element, list);
    result[entry.kind] = true;
  }

  for (const [element, files] of filesByElement) {
    const dataTransfer = new DataTransfer();
    // Preserve anything already selected on a multi-file field so a second
    // attach call (e.g. cover letter after resume) doesn't clobber the first.
    if (element.multiple) {
      Array.from(element.files ?? []).forEach((f) => dataTransfer.items.add(f));
    }
    files.forEach((f) => dataTransfer.items.add(f));
    element.files = dataTransfer.files;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return result;
}

/**
 * Multi-page ATS flows (Workday especially) swap the form without a full
 * page load, so the panel's "filled" summary silently goes stale and the
 * next page looks already handled. Tell the panel when that happens.
 *
 * Detection only — filling still requires a click. Auto-filling a page the
 * user has not looked at could put wrong data into a live application.
 */
function watchForPageChanges() {
  /** Which fields are on screen — the thing that actually matters to filling. */
  const formFingerprint = () =>
    findUnrecognizedFields(document)
      .map((f) => f.signature)
      .concat(matchFields(document).map((m) => m.path))
      .sort()
      .join('|');

  let lastUrl = location.href;
  let lastForm = formFingerprint();

  const announce = () => {
    const url = location.href;
    const form = formFingerprint();
    // Some flows change the URL, others swap the form in place and keep it.
    // Either way the panel's summary is now about a page that is gone.
    if (url === lastUrl && form === lastForm) return;
    lastUrl = url;
    lastForm = form;
    if (!form) return; // Nothing fillable here; no point nudging the user.
    // The panel may not be open; a failed send is expected and harmless.
    browser.runtime.sendMessage({ type: 'page-changed', url }).catch(() => {});
  };

  // History API navigations do not fire an event of their own.
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function patched(this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      announce();
      return result;
    };
  }
  window.addEventListener('popstate', announce);

  // Debounced, because a single render can produce hundreds of mutations.
  let timer: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(announce, 500);
  }).observe(document.body, { childList: true, subtree: true });
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    watchForPageChanges();

    browser.runtime.onMessage.addListener((message: IncomingMessage, _sender, sendResponse) => {
      if (message?.type === 'fill-page') {
        (async () => {
          const profile = await getProfile();
          const overrides = await getOverridesForHost(location.hostname);

          const fieldMatches = matchFields(document, overrides);
          const fieldResult = fillFields(fieldMatches, profile);

          const radioGroupMatches = matchRadioGroups(document);
          const radioResult = fillRadioGroups(radioGroupMatches, profile);

          const response: FillPageResponse = {
            filledCount: fieldResult.filledCount + radioResult.filledCount,
            unmatchedCount: fieldResult.skippedCount + radioResult.skippedCount,
            unmatchedLabels: [...fieldResult.skippedLabels, ...radioResult.skippedLabels],
            unrecognized: findUnrecognizedFields(document, overrides),
            hostname: location.hostname,
          };
          sendResponse(response);
        })();
        return true;
      }

      if (message?.type === 'get-job-info') {
        (async () => {
          const response: GetJobInfoResponse = {
            companyName: scrapeCompanyName(),
            jobTitle: scrapeJobTitle(),
            jobDescription: await scrapeJobDescription(),
            jobUrl: location.href,
          };
          sendResponse(response);
        })();
        return true;
      }

      if (message?.type === 'attach-documents') {
        const entries = message.files.map((f) => ({
          kind: f.kind,
          file: new File([f.data], f.name, { type: f.mimeType }),
        }));
        const response: AttachDocumentsResponse = { attached: attachDocuments(entries) };
        sendResponse(response);
        return true;
      }

      if (message?.type === 'get-questions') {
        (async () => {
          detectedQuestions.clear();
          const found = detectQuestions(document);
          const questions = found.map((q, i) => {
            const id = `q${i}`;
            detectedQuestions.set(id, q.element);
            return { id, question: q.question };
          });
          const response: GetQuestionsResponse = {
            questions,
            jobDescription: await scrapeJobDescription(),
          };
          sendResponse(response);
        })();
        return true;
      }

      if (message?.type === 'insert-answer') {
        const element = detectedQuestions.get(message.id);
        if (element) {
          setNativeFieldValue(element, message.text);
        }
        const response: InsertAnswerResponse = { inserted: Boolean(element) };
        sendResponse(response);
        return true;
      }

      return undefined;
    });
  },
});
