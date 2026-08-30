import type { DocumentKind } from './document-matcher';
import type { UnrecognizedField } from './field-matcher';

/**
 * One application's progress, kept per browser tab. Each job application
 * lives in its own tab, so results belong to that tab rather than to the
 * panel: switching tabs must show that application's own state, and work
 * started on one must survive looking at another.
 */
export type FillResult =
  | {
      status: 'done';
      filledCount: number;
      unmatchedCount: number;
      unmatchedLabels: string[];
      unrecognized: UnrecognizedField[];
      /** Answers written without the user typing them, shown so they can be checked. */
      autoAnswered: Array<{ label: string; answer: string; source: 'profile' | 'ai' }>;
      hostname: string;
      /** How many frames answered, so an embedded application is visible as one. */
      frameCount?: number;
      /**
       * Frames whose previous values were recorded, with how many fields each
       * holds. Undo has to go back to the same frames that were written.
       */
      undo?: Array<{ frameId: number | null; fields: number }>;
      /** Set once the page navigated or swapped its form after this fill, so
       * the summary is not mistaken for describing what is on screen now. */
      stale?: boolean;
    }
  | { status: 'error'; message: string };

export interface AttachOutcome {
  ok: boolean;
  reason?: string;
}

export interface TabState {
  fill?: FillResult;
  attach?: {
    results: Partial<Record<DocumentKind, AttachOutcome>>;
    /** A failure that belongs to the attempt rather than to one document. */
    error?: string;
  };
  draft?: DraftRun;
  notion?: { loggedUrl: string };
}

export interface DraftEntry {
  id: string;
  question: string;
  text: string;
  saved: boolean;
  /** Which model produced this, when it was not a saved answer. With a
   * rotating pool the answers in one run can come from different models. */
  model?: string;
  inserted?: boolean;
  error?: string;
  insertError?: string;
}

export interface DraftRun {
  status: 'running' | 'done' | 'error';
  done: number;
  total: number;
  entries: DraftEntry[];
  message?: string;
}

const KEY_PREFIX = 'tab:';

const keyFor = (tabId: number) => `${KEY_PREFIX}${tabId}`;

/**
 * Session storage, not local: this is in-flight progress about pages that are
 * currently open, and it should not outlive the browser session or accumulate
 * forever on disk.
 */
function area() {
  return browser.storage.session ?? browser.storage.local;
}

export async function getTabState(tabId: number): Promise<TabState> {
  const key = keyFor(tabId);
  const stored = await area().get(key);
  return (stored[key] as TabState | undefined) ?? {};
}

export async function setTabState(tabId: number, state: TabState): Promise<void> {
  await area().set({ [keyFor(tabId)]: state });
}

/**
 * Serialized per tab. The background worker writes draft progress after every
 * question while the panel writes fill and attach results, and an unserialized
 * read-modify-write would let the slower of two overlapping writes drop the
 * other's section entirely.
 */
const writeQueues = new Map<number, Promise<unknown>>();

/** Read-modify-write against one tab's slice, leaving the others untouched. */
export function patchTabState(tabId: number, patch: Partial<TabState>): Promise<TabState> {
  const previous = writeQueues.get(tabId) ?? Promise.resolve();
  const next = previous.then(async () => {
    const merged = { ...(await getTabState(tabId)), ...patch };
    await setTabState(tabId, merged);
    return merged;
  });
  // Keep the chain alive even if this write fails, so later writes still run.
  writeQueues.set(
    tabId,
    next.catch(() => undefined)
  );
  return next;
}

export async function clearTabState(tabId: number): Promise<void> {
  writeQueues.delete(tabId);
  await area().remove(keyFor(tabId));
}
