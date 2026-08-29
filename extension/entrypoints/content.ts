import { fillFields, fillInferredFields, fillRadioGroups, setNativeFieldValue } from '@/lib/filler';
import {
  findUnrecognizedElements,
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
import type { ChooseOptionMessage } from '@/entrypoints/background';

export interface FillPageMessage {
  type: 'fill-page';
}
export interface FillPageResponse {
  filledCount: number;
  unmatchedCount: number;
  unmatchedLabels: string[];
  /** Fields we could fill but could not identify — the panel offers to learn these. */
  unrecognized: UnrecognizedField[];
  /** Questions answered from the profile rather than a matched field. */
  inferred: Array<{ label: string; answer: string }>;
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
export interface AttachOutcome {
  ok: boolean;
  /** Why an attach failed, in words worth showing the user. */
  reason?: string;
}
export interface AttachDocumentsResponse {
  attached: Partial<Record<DocumentKind, AttachOutcome>>;
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
function attachDocuments(
  entries: Array<{ kind: DocumentKind; file: File }>
): Partial<Record<DocumentKind, AttachOutcome>> {
  const matches = matchFileInputs(document);
  const dedicated: Record<DocumentKind, FileInputMatch | undefined> = {
    resume: matches.find((m) => m.kind === 'resume'),
    coverLetter: matches.find((m) => m.kind === 'coverLetter'),
  };
  const fallback = matches.find((m) => m.kind === 'additional');

  const result: Partial<Record<DocumentKind, AttachOutcome>> = {};
  const filesByElement = new Map<HTMLInputElement, File[]>();
  const targetByKind = new Map<DocumentKind, HTMLInputElement>();

  for (const entry of entries) {
    const target = dedicated[entry.kind] ?? fallback;
    if (!target) {
      result[entry.kind] = { ok: false, reason: 'no upload field for this document on the page' };
      continue;
    }
    const list = filesByElement.get(target.element) ?? [];
    list.push(entry.file);
    filesByElement.set(target.element, list);
    targetByKind.set(entry.kind, target.element);
  }

  for (const [element, files] of filesByElement) {
    const dataTransfer = new DataTransfer();
    // Preserve anything already selected on a multi-file field so a second
    // attach call (e.g. cover letter after resume) doesn't clobber the first.
    if (element.multiple) {
      Array.from(element.files ?? []).forEach((f) => dataTransfer.items.add(f));
    }
    files.forEach((f) => dataTransfer.items.add(f));
    try {
      element.files = dataTransfer.files;
    } catch {
      // Some uploaders make `files` non-writable; that is a real failure and
      // the verification below reports it rather than assuming success.
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Verify rather than assume. Finding a field is not the same as the file
  // being accepted, and reporting "attached" for a document the form never
  // received is worse than reporting nothing at all.
  for (const entry of entries) {
    if (result[entry.kind]) continue;
    const element = targetByKind.get(entry.kind);
    const landed = Array.from(element?.files ?? []).some((f) => f.name === entry.file.name);
    result[entry.kind] = landed
      ? { ok: true }
      : { ok: false, reason: 'the upload field did not accept the file' };
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

          // This script never reads settings at all. Reading them here would
          // pull the whole stored blob — Notion token and OpenRouter key
          // included — into a script that runs on every page the user visits,
          // just to learn one boolean. The worker holds the secrets, decides
          // whether AI escalation is even configured, and answers with an
          // option index and nothing else.
          const aiOptionFallback = async (question: string, options: string[], value: string) => {
            const response = (await browser.runtime.sendMessage({
              type: 'choose-option',
              question,
              options,
              value,
            } satisfies ChooseOptionMessage)) as { index?: number } | undefined;
            return response?.index ?? -1;
          };

          const fieldMatches = matchFields(document, overrides);
          // Only consulted when exact, word-set and synonym matching have all
          // failed, so an ordinary form makes no model calls at all.
          const fieldResult = await fillFields(fieldMatches, profile, { aiOptionFallback });

          const radioGroupMatches = matchRadioGroups(document);
          const radioResult = fillRadioGroups(radioGroupMatches, profile);

          // Questions the profile already settles — "are you still studying?",
          // "are you based in Berlin?" — answered without asking the user again.
          const unrecognized = findUnrecognizedElements(document, overrides);
          const inferred = await fillInferredFields(unrecognized, profile, { aiOptionFallback });
          const inferredLabels = new Set(inferred.filled.map((f) => f.label));

          const response: FillPageResponse = {
            filledCount: fieldResult.filledCount + radioResult.filledCount + inferred.filled.length,
            unmatchedCount: fieldResult.skippedCount + radioResult.skippedCount,
            unmatchedLabels: [...fieldResult.skippedLabels, ...radioResult.skippedLabels],
            // Anything just answered by inference is no longer something the
            // user needs to teach us.
            unrecognized: unrecognized
              .filter((f) => !inferredLabels.has(f.label))
              .map(({ label, signature }) => ({ label, signature })),
            inferred: inferred.filled,
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
          const profile = await getProfile();
          const found = detectQuestions(document, profile);
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
