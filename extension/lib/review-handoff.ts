import type { CoverLetterResult, TailorResult } from './tailor-run';

/**
 * Passing a tailored application from the side panel to the review tab.
 *
 * Session storage rather than a message: the tab does not exist yet when the
 * panel hands off, and a tab that is reloaded must still find its content.
 * It dies with the browser session, which is right — a half-reviewed
 * application is not worth keeping on disk.
 */

export interface ReviewHandoff {
  result: TailorResult;
  letter: CoverLetterResult | null;
  company: string;
  role: string;
  jobDescription: string;
  createdAt: number;
}

const KEY = 'review-handoff';

function area() {
  return browser.storage.session ?? browser.storage.local;
}

export async function putReview(handoff: Omit<ReviewHandoff, 'createdAt'>): Promise<void> {
  await area().set({ [KEY]: { ...handoff, createdAt: Date.now() } satisfies ReviewHandoff });
}

export async function takeReview(): Promise<ReviewHandoff | null> {
  const stored = await area().get(KEY);
  return (stored[KEY] as ReviewHandoff | undefined) ?? null;
}

/** Opens the review tab, or focuses it if one is already showing this. */
export async function openReviewTab(): Promise<void> {
  const url = browser.runtime.getURL('/review.html');
  const existing = await browser.tabs.query({ url });
  if (existing[0]?.id !== undefined) {
    await browser.tabs.update(existing[0].id, { active: true });
    await browser.tabs.reload(existing[0].id);
    return;
  }
  await browser.tabs.create({ url });
}
