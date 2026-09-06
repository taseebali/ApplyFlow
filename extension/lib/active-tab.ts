import type { FrameReport } from './frames';
import type { GetJobInfoMessage, GetJobInfoResponse } from '@/entrypoints/content';

/**
 * Which tab the panel is acting on, and which of its frames can be filled.
 *
 * Lived in DailyView until three other components needed it. Neither is a
 * component, so neither belongs among them.
 */

/**
 * The frames of this tab that hold something fillable, richest first. The
 * worker owns the registry because only it sees each sender's `frameId`.
 */
export async function listFillableFrames(tabId: number): Promise<FrameReport[]> {
  try {
    const response = (await browser.runtime.sendMessage({ type: 'get-frames', tabId })) as
      | { frames?: FrameReport[] }
      | undefined;
    return response?.frames ?? [];
  } catch {
    return [];
  }
}

export async function getActiveTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found. Open a job application page first.');
  return tab.id;
}

/**
 * Asks the frames that hold something, richest first, and takes the first
 * answer that is actually an answer.
 *
 * `tabs.sendMessage` without a frameId reaches every frame and resolves with
 * whichever replies first, which with an embedded application is a race rather
 * than an answer: the top frame has no form, replies instantly with nothing,
 * and wins. `lib/frames.ts` names this and the fill path was fixed for it; the
 * job-info, question and attachment paths were not, and each has its own
 * version of the same bug.
 *
 * `isUseful` is what makes this work: an empty reply is not a reply, so the
 * search moves on to the next frame instead of stopping at the first one that
 * merely responded.
 */
export async function askFrames<T>(
  tabId: number,
  message: unknown,
  isUseful: (response: T) => boolean
): Promise<T | null> {
  const frames = await listFillableFrames(tabId);
  // The top frame last, not never: a page with no registered frames at all is
  // an ordinary unframed form, and that is where the answer will be.
  const targets: Array<number | null> = [...frames.map((frame) => frame.frameId), null];

  let fallback: T | null = null;

  for (const frameId of targets) {
    try {
      const response: T = await browser.tabs.sendMessage(
        tabId,
        message,
        frameId === null ? {} : { frameId }
      );
      if (response !== undefined && isUseful(response)) return response;
      // Kept so a page where no frame has anything still gets a real shape
      // back rather than null, which callers would have to special-case.
      if (response !== undefined && fallback === null) fallback = response;
    } catch {
      // A frame with no content script, or one that has since gone.
    }
  }

  return fallback;
}

/** What "nothing found" looks like, so no caller has to handle null itself. */
export const EMPTY_JOB_INFO: GetJobInfoResponse = {
  companyName: null,
  jobTitle: null,
  jobDescription: null,
  jobUrl: '',
};

/**
 * The posting, from whichever frame actually holds it.
 *
 * Four call sites each sent this untargeted and took whatever came back first,
 * which on an embedded application is the top frame answering with nothing.
 * That is a large part of why the panel could report no posting while looking
 * straight at one.
 */
export async function readJobInfo(tabId: number): Promise<GetJobInfoResponse | null> {
  return askFrames<GetJobInfoResponse>(
    tabId,
    { type: 'get-job-info' } satisfies GetJobInfoMessage,
    (info) => Boolean(info.companyName || info.jobTitle || info.jobDescription)
  );
}
