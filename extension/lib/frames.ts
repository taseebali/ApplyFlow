/**
 * Applications are routinely served inside an iframe — Greenhouse, Lever and
 * SmartRecruiters are all commonly embedded into a company's own careers page.
 * The content script previously ran only in the top document, found no form,
 * and reported "0 filled", which is indistinguishable from a site we do not
 * understand.
 *
 * Running in every frame creates a second problem: `tabs.sendMessage` without a
 * `frameId` broadcasts, and only the first reply survives — with several frames
 * that is a race, not an answer. So frames that actually hold a form register
 * themselves with the background worker, which knows each sender's `frameId`,
 * and the panel then addresses frames individually.
 *
 * Deliberately no `webNavigation` or `scripting` permission: `sender.frameId`
 * on an ordinary message carries everything needed, and an extra permission is
 * a real cost at review time.
 */

export interface FrameReport {
  frameId: number;
  url: string;
  /** Fields that could take a profile value. */
  fieldCount: number;
  /** File inputs, which is what makes a frame worth trying for attachments. */
  fileInputCount: number;
  /** Open-ended questions, so a frame holding only essay boxes still counts. */
  questionCount: number;
}

/**
 * Whether this document holds anything worth filling. Runs in every frame on
 * every page the user visits, so it stays a cheap DOM count — no matching, no
 * profile read, no storage access.
 */
export function summarizeFrame(root: Document): Omit<FrameReport, 'frameId' | 'url'> {
  const fields = root.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea'
  );

  let fieldCount = 0;
  let fileInputCount = 0;
  let questionCount = 0;

  for (const el of fields) {
    if (el instanceof HTMLInputElement && el.type === 'file') {
      fileInputCount++;
      continue;
    }
    fieldCount++;
    if (el instanceof HTMLTextAreaElement) questionCount++;
  }

  return { fieldCount, fileInputCount, questionCount };
}

export function frameHasWork(report: Pick<FrameReport, 'fieldCount' | 'fileInputCount' | 'questionCount'>): boolean {
  // A lone search box is not an application. Two fields is the smallest thing
  // that plausibly is; a file input alone is worth registering because the
  // attach path can still use it.
  return report.fieldCount >= 2 || report.fileInputCount > 0;
}

/**
 * The frames worth acting on, richest first.
 *
 * Every qualifying frame is returned rather than just the best one: a page can
 * legitimately split an application across frames (the form in one, an upload
 * widget in another), and filling only the largest would quietly skip the rest.
 * The ordering matters because the panel reports the primary frame's hostname.
 */
export function rankFrames(frames: FrameReport[]): FrameReport[] {
  return [...frames]
    .filter((frame) => frameHasWork(frame))
    .sort((a, b) => {
      const byFields = b.fieldCount - a.fieldCount;
      if (byFields !== 0) return byFields;
      const byQuestions = b.questionCount - a.questionCount;
      if (byQuestions !== 0) return byQuestions;
      // A stable tiebreak, and the top frame is the more likely primary.
      return a.frameId - b.frameId;
    });
}

/** Merges per-frame fill results into the single figure the panel shows. */
export function mergeFillResults<
  T extends { filledCount: number; unmatchedCount: number; unmatchedLabels: string[]; unrecognized: unknown[] },
>(results: T[]): { filledCount: number; unmatchedCount: number; unmatchedLabels: string[]; unrecognized: unknown[] } {
  return {
    filledCount: results.reduce((sum, r) => sum + r.filledCount, 0),
    unmatchedCount: results.reduce((sum, r) => sum + r.unmatchedCount, 0),
    unmatchedLabels: results.flatMap((r) => r.unmatchedLabels),
    unrecognized: results.flatMap((r) => r.unrecognized),
  };
}
