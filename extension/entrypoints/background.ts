import { forgetNotionSettings, getSettings } from '@/lib/settings';
import { chooseOptionWithAi } from '@/lib/option-ai';
import { getProfile } from '@/lib/storage';
import { draftAnswer } from '@/lib/llm-client';
import { findSimilarAnswer, normalizeQuestion } from '@/lib/question-matching';
import { clearTabState, getTabState, patchTabState, type DraftEntry } from '@/lib/tab-state';
import { isJobUrl } from '@/lib/job-urls';
import type { GetQuestionsMessage, GetQuestionsResponse } from '@/entrypoints/content';
import { rankFrames, type FrameReport } from '@/lib/frames';
import { runBankGeneration } from '@/lib/bank-run';
import type { TargetFamily } from '@/lib/target-families';
import { handleDashboardRequest, isAllowedOrigin, type DashboardRequest, type DashboardResponse } from '@/lib/dashboard-bridge';
import { getRecord, listRecords, patchRecord } from '@/lib/application-db';
import { migrateApplicationLog } from '@/lib/application-migrate';

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

export interface StartBankMessage {
  type: 'start-bank';
  /** Skips inference when the user has already approved a family list. */
  families?: TargetFamily[];
  /** Regenerate only these items, leaving the rest of the bank alone. */
  onlySourceIds?: string[];
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

    // Record the drafting against this tab's history entry, if the page was
    // filled first. Counts answers that actually produced text.
    const applicationId = (await getTabState(tabId)).applicationId;
    if (applicationId) {
      const drafted = entries.filter((entry) => entry.text.trim().length > 0 && !entry.error).length;
      void patchRecord(applicationId, { questionsDrafted: drafted });
    }
  } catch (err) {
    await fail(err instanceof Error ? err.message : 'Could not draft answers.');
  }
}

export default defineBackground(() => {
  /*
   * The panel belongs to one tab, not to the browser.
   *
   * `side_panel.default_path` in the manifest enables it everywhere, so opening
   * it on a Greenhouse posting left it open on YouTube, on the model
   * catalogue, and on a second application — all of them showing the first
   * tab's state. Disabling the default and enabling per tab is what makes one
   * tab one application.
   *
   * Clicking the toolbar icon still opens the panel, so the user never leaves
   * the tab they are filling in. Where the panel may not open, a popup takes
   * over the click: Chrome gives a popup precedence over the side panel, which
   * is how one button does both.
   */
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('Failed to set side panel behavior', err));

  void browser.sidePanel?.setOptions({ enabled: false }).catch(() => undefined);

  /**
   * Decides whether the panel may open on one tab, and says so through the
   * toolbar button.
   *
   * A tab that already has an application keeps the panel whatever it is
   * showing now: opening the company's About page mid-application should not
   * take the panel away, and the work is that tab's until the tab is done with
   * it.
   */
  async function syncPanel(tabId: number, url: string | undefined): Promise<void> {
    try {
      const state = await getTabState(tabId);
      const started = Object.keys(state).length > 0;
      const allowed = started || (url !== undefined && isJobUrl(url));

      await browser.sidePanel?.setOptions({ tabId, path: 'sidepanel.html', enabled: allowed });
      // An empty popup string hands the click back to the side panel.
      await browser.action?.setPopup({ tabId, popup: allowed ? '' : 'blocked.html' });
    } catch {
      // The tab closed while we were deciding, or it is a browser page the
      // API refuses. Either way there is nothing to enable.
    }
  }

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

      // The top frame's own address, which is the tab's. Chrome supplies
      // `sender.url` to the receiver of any message with no permission at all,
      // so this is how the panel decides where it may open without the "tabs"
      // permission — which would read as "read your browsing history" and buy
      // nothing this does not already have.
      if (sender.frameId === 0) void onNavigated(tabId, sender.url ?? message.url ?? '');
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

  // Bank generation is the slowest thing this extension does and lands at
  // onboarding. It runs here so closing the panel does not abandon it.
  browser.runtime.onMessage.addListener((message: StartBankMessage, _sender, sendResponse) => {
    if (message?.type !== 'start-bank') return undefined;
    void runBankGeneration({ families: message.families, onlySourceIds: message.onlySourceIds });
    sendResponse({ started: true });
    return true;
  });

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

  /*
   * The dashboard asks; the extension answers.
   *
   * The dashboard is a static page with no storage and no server behind it, so
   * every record it shows comes through here. Two gates, deliberately: the
   * manifest's `externally_connectable` decides who may send at all, and this
   * checks the origin again — a mistake in one should not be the only thing
   * between a web page and an application history.
   */
  browser.runtime.onMessageExternal.addListener(
    (request: DashboardRequest, sender, sendResponse: (response: DashboardResponse) => void) => {
      if (!sender.origin || !isAllowedOrigin(sender.origin)) {
        sendResponse({ ok: false, error: 'Not an allowed origin.' });
        return false;
      }

      void handleDashboardRequest(request, {
        list: listRecords,
        get: getRecord,
        patch: patchRecord,
      })
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: 'Could not read applications.' }));

      return true;
    }
  );

  // One-way, and a no-op after the first run. The old log is capped at 500
  // entries and cannot hold documents, so nothing is left behind on purpose.
  browser.runtime.onInstalled.addListener(() => {
    void migrateApplicationLog();
    // Nothing reads the old Notion token any more, which is not the same as it
    // being gone: it is still on disk, and still a live credential.
    void forgetNotionSettings();
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

  /**
   * A tab that moves to a *different* posting starts a new application.
   *
   * Only a different posting: navigating to YouTube and back, or to the
   * company's own site mid-application, keeps everything. Stamping the URL is
   * also what stops a new tab inheriting a closed application's state, since
   * Chrome reuses tab ids.
   */
  async function onNavigated(tabId: number, url: string): Promise<void> {
    const state = await getTabState(tabId);
    const movedToAnotherPosting =
      isJobUrl(url) && state.url !== undefined && state.url !== url;

    if (movedToAnotherPosting) await clearTabState(tabId);
    if (isJobUrl(url)) await patchTabState(tabId, { url });
    await syncPanel(tabId, url);
  }

  /*
   * On switching tabs there is no fresh message to read a URL from, so the
   * decision comes from what that tab already recorded. A tab we have never
   * heard from keeps the panel shut, which is the right default: either its
   * page has no content script, or it has not loaded yet and will announce
   * itself in a moment.
   */
  browser.tabs.onActivated.addListener(({ tabId }) => {
    void getTabState(tabId)
      .then((state) => syncPanel(tabId, state.url))
      .catch(() => undefined);
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
