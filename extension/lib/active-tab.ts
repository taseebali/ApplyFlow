import type { FrameReport } from './frames';

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
