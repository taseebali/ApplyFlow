import { getSettings } from '@/lib/settings';
import { chooseOptionWithAi } from '@/lib/option-ai';
import { getProfile } from '@/lib/storage';
import { draftAnswer } from '@/lib/llm-client';
import { findSimilarAnswer, normalizeQuestion } from '@/lib/question-matching';
import { clearTabState, getTabState, patchTabState, type DraftEntry } from '@/lib/tab-state';
import type { GetQuestionsMessage, GetQuestionsResponse } from '@/entrypoints/content';
import { rankFrames, type FrameReport } from '@/lib/frames';

/**
 * Which frames of which tab hold a fillable form. Held in the worker because
 * it is the only party that sees `sender.frameId`, and rebuilt from scratch on
 * every navigation — a frame that no longer exists must never be messaged.
 */
const frameRegistry = new Map<number, Map<number, FrameReport>>();

function recordFrame(tabId: number, report: FrameReport): void {
  const frames = frameRegistry.get(tabId) ?? new Map<number, FrameReport>();
  frames.set(report.frameId, report);
  frameRegistry.set(tabId, frames);
}

export function framesForTab(tabId: number): FrameReport[] {
  return rankFrames([...(frameRegistry.get(tabId)?.values() ?? [])]);
}

export interface ChooseOptionMessage {
  type: 'choose-option';
  question: string;
  options: string[];
  value: string;
}

export interface StartDraftMessage {
  type: 'start-draft';
  tabId: number;
}

/**
 * Drafting runs here rather than in the side panel because it is slow and the
 * panel is not permanent: it unmounts when the user switches tab and closes
 * when they look at something else. Running in the worker means a draft
 * started on one application keeps going while another is worked on, which is
 * the whole point of per-tab instances.
 */
async function runDraft(tabId: number): Promise<void> {
  const fail = (message: string) =>
    patchTabState(tabId, { draft: { status: 'error', done: 0, total: 0, entries: [], message } });

  try {
    const settings = await getSettings();
    if (!settings.llm.backend) {
      await fail('Set up AI drafting in Settings first.');
      return;
    }

    const message: GetQuestionsMessage = { type: 'get-questions' };
    // Addressed by frame: an un-targeted send goes to every frame and keeps
    // whichever answers first, which on an embedded application is a coin toss.
    const frames = framesForTab(tabId);
    const target = frames.find((frame) => frame.questionCount > 0) ?? frames[0];
    const found: GetQuestionsResponse = await browser.tabs.sendMessage(
      tabId,
      message,
      target ? { frameId: target.frameId } : undefined
    );

    if (!found.questions.length) {
      await fail('No open-ended questions found on this page.');
      return;
    }

    const profile = await getProfile();
    const entries: DraftEntry[] = [];
    const total = found.questions.length;

    await patchTabState(tabId, { draft: { status: 'running', done: 0, total, entries: [] } });

    for (const question of found.questions) {
      // A saved answer wins: instant, free, and already worded how the user
      // wants it. Exact-after-normalisation only — a loose match would put
      // the wrong answer into a real application.
      const saved = profile.customQA.find(
        (entry) => normalizeQuestion(entry.question) === normalizeQuestion(question.question)
      );

      if (saved) {
        entries.push({ id: question.id, question: question.question, text: saved.answer, saved: true });
      } else {
        try {
          // Everything answered so far on this form, so the model can avoid
          // reaching for the same example three times running. A reviewer
          // reads these answers together, and the repetition shows.
          const previousAnswers = entries
            .filter((entry) => entry.text.trim().length > 0 && !entry.error)
            .map((entry) => ({ question: entry.question, text: entry.text }));

          const { text, model, usage } = await draftAnswer(
            {
              question: question.question,
              jobDescription: found.jobDescription,
              profile,
              previousAnswers,
              maxLength: question.maxLength,
            },
            settings.llm
          );
          // A saved answer to a near-identical question, offered alongside the
          // fresh draft. Never substituted silently: the wording differs, and
          // only the user can say whether that matters.
          const similar = findSimilarAnswer(question.question, profile.customQA);
          entries.push({
            id: question.id,
            question: question.question,
            text,
            saved: false,
            model,
            ...(usage ? { usage } : {}),
            ...(similar ? { similar: { question: similar.entry.question, text: similar.entry.answer } } : {}),
          });
        } catch (err) {
          // One failure must not discard the answers already paid for.
          entries.push({
            id: question.id,
            question: question.question,
            text: '',
            saved: false,
            error: err instanceof Error ? err.message : 'Could not draft this answer.',
          });
        }
      }

      // Written after every question so a panel reopened mid-run sees real
      // progress instead of an unchanging spinner.
      await patchTabState(tabId, {
        draft: { status: 'running', done: entries.length, total, entries: [...entries] },
      });
    }

    await patchTabState(tabId, {
      draft: { status: 'done', done: entries.length, total, entries },
    });
  } catch (err) {
    await fail(err instanceof Error ? err.message : 'Could not draft answers.');
  }
}

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel instead of a popup, so the
  // user never has to leave the tab they're filling out to see their profile.
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('Failed to set side panel behavior', err));

  // Frames announce themselves when they load and after an in-page step change.
  browser.runtime.onMessage.addListener(
    (message: { type?: string; url?: string; fieldCount?: number; fileInputCount?: number; questionCount?: number }, sender) => {
      if (message?.type !== 'frame-has-form') return undefined;
      const tabId = sender.tab?.id;
      if (tabId === undefined || sender.frameId === undefined) return undefined;
      recordFrame(tabId, {
        frameId: sender.frameId,
        url: message.url ?? '',
        fieldCount: message.fieldCount ?? 0,
        fileInputCount: message.fileInputCount ?? 0,
        questionCount: message.questionCount ?? 0,
      });
      return undefined;
    }
  );

  // The panel asks which frames are worth addressing.
  browser.runtime.onMessage.addListener(
    (message: { type?: string; tabId?: number }, _sender, sendResponse) => {
      if (message?.type !== 'get-frames' || typeof message.tabId !== 'number') return undefined;
      sendResponse({ frames: framesForTab(message.tabId) });
      return true;
    }
  );

  browser.runtime.onMessage.addListener((message: StartDraftMessage, sender, sendResponse) => {
    if (message?.type !== 'start-draft') return undefined;

    // Drafting reads the whole profile, sends it to the configured provider on
    // the user's own API key, and writes another tab's state. Only this
    // extension's own pages may ask for it: a side-panel page has no
    // `sender.tab`, a content script always does.
    const fromExtensionPage =
      sender.id === browser.runtime.id &&
      sender.tab === undefined &&
      (sender.url?.startsWith(browser.runtime.getURL('/')) ?? false);

    if (!fromExtensionPage || !Number.isInteger(message.tabId)) {
      sendResponse({ started: false });
      return true;
    }

    // Deliberately not awaited: the panel gets an immediate acknowledgement
    // and follows progress through the tab's stored state.
    void runDraft(message.tabId);
    sendResponse({ started: true });
    return true;
  });

  // A closed tab's application is over; keep session storage from growing.
  browser.tabs.onRemoved.addListener((tabId) => {
    void clearTabState(tabId);
    frameRegistry.delete(tabId);
  });

  // A navigation, or an in-page step change, replaces the form — so the stored
  // results describe a page that no longer exists. Marked here rather than in
  // the panel because the panel is often closed when it happens.
  const markFillStale = (tabId: number) =>
    void getTabState(tabId).then((state) => {
      if (state.fill?.status !== 'done' || state.fill.stale) return;
      void patchTabState(tabId, { fill: { ...state.fill, stale: true }, attach: undefined });
    });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'loading' || !changeInfo.url) return;
    // The old frame ids describe a page that no longer exists. Each frame of
    // the new page announces itself as it loads.
    frameRegistry.delete(tabId);
    markFillStale(tabId);
  });

  // The content script asks here rather than calling the provider itself: the
  // API key must not be readable from a script that runs on every page, and the
  // keyed request belongs in a trusted context with the extension's own host
  // permissions rather than in the page's network context.
  browser.runtime.onMessage.addListener(
    (message: ChooseOptionMessage, sender, sendResponse: (response: { index: number }) => void) => {
      if (message?.type !== 'choose-option') return undefined;
      // Must come from this extension's content script in a real tab.
      if (sender.id !== browser.runtime.id || sender.tab?.id === undefined) return undefined;

      (async () => {
        try {
          const { llm } = await getSettings();
          const index = await chooseOptionWithAi(message.question, message.options, message.value, llm);
          sendResponse({ index });
        } catch {
          sendResponse({ index: -1 });
        }
      })();
      return true;
    }
  );

  // Sent by the content script when a multi-step application swaps the form
  // without a navigation.
  browser.runtime.onMessage.addListener((message: { type?: string }, sender) => {
    if (message?.type === 'page-changed' && sender.tab?.id !== undefined) markFillStale(sender.tab.id);
    return undefined;
  });
});
