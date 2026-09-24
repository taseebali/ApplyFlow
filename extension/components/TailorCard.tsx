import { useState } from 'react';
import { Step } from '@/components/Step';
import { tailorResume, writeCoverLetter, type CoverLetterResult, type TailorResult } from '@/lib/tailor-run';
import { readJobInfo, getActiveTabId } from '@/lib/active-tab';
import { openReviewTab, putReview } from '@/lib/review-handoff';
import type { Posting } from '@/components/JobContext';
import type { OpenSetup } from '@/components/panel-types';
import { useTabState } from '@/components/useTabState';

type Status = { kind: 'idle' } | { kind: 'working'; what: What } | { kind: 'error'; message: string };

/** What the user asked to be built. Nothing runs until one of these is chosen. */
type What = 'resume' | 'letter' | 'both';

const LABELS: Record<What, string> = {
  resume: 'Resume',
  letter: 'Cover letter',
  both: 'Both',
};

/**
 * How many model requests each choice costs, so the price is visible before it
 * is paid.
 *
 * One either way, which is what lets this stay a flat number: with a bank the
 * request ranks a shortlist that already exists, and without one it writes the
 * bullets for this posting and no ranking call follows. A letter is one more,
 * and a letter on its own skips the ranking because it does not read the
 * ordering.
 */
const REQUESTS: Record<What, number> = { resume: 1, letter: 1, both: 2 };

/**
 * Builds a tailored application for the posting in front of you.
 *
 * The row used to run the whole pass the moment it was clicked, under the
 * label "Tailor a resume" — so someone who only wanted a cover letter paid for
 * a resume they would not use, and the label named one of the two things the
 * row actually did. It expands now, and nothing is sent until a document type
 * is chosen.
 *
 * The result opens in the review tab rather than being previewed here: a
 * resume cannot be read, let alone edited, in a 400px column, and the tab
 * shows the actual page.
 */
export function TailorCard({
  index,
  posting,
  onOpenSetup,
}: {
  index: number;
  posting: Posting;
  onOpenSetup: OpenSetup;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [closed, setClosed] = useState(true);
  // The result belongs to the application, not to this component: it used to
  // be thrown away by a trip to another tab, and the panel then offered to
  // generate it again at full price.
  const { state: tabState, patch } = useTabState();
  const built = tabState.tailor ?? null;

  const build = async (what: What) => {
    setStatus({ kind: 'working', what });
    try {
      const info = await readJobInfo(await getActiveTabId());
      const jobDescription = info?.jobDescription ?? '';

      // A letter needs the selected bullets to write from, but not the ranking
      // that orders them, so asking for a letter alone costs one request
      // rather than two.
      const result = await tailorResume({ jobDescription, rank: what !== 'letter' });

      const letter =
        what === 'resume'
          ? null
          : await writeCoverLetter({
              jobDescription,
              company: posting.company,
              role: posting.role,
              resumeBullets: result.selected,
            });

      await patch({ tailor: { result, letter, jobDescription } });
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not build that.' });
    }
  };

  const openReview = async () => {
    if (!built) return;
    await putReview({
      result: built.result,
      letter: built.letter,
      company: posting.company,
      role: posting.role,
      jobDescription: built.jobDescription,
      tabId: await getActiveTabId(),
    });
    await openReviewTab();
  };

  const result = built?.result ?? null;
  const working = status.kind === 'working';

  /*
   * One line for where this stands.
   *
   * The panel used to show the score ring, the keyword chips, the untailored
   * warning and the open button all inline — a resume's worth of detail in a
   * 400px column, under a strip that re-ran the build when clicked. All of it
   * is in the review tab, on the actual page, where it can be read and edited.
   */
  const status_line = working
    ? `Writing ${LABELS[status.what].toLowerCase()}…`
    : status.kind === 'error'
      ? status.message
      : result
        ? `${result.score}% of what the posting asks for · ${
            built?.letter ? 'resume and cover letter' : 'resume'
          } ready`
        : 'Nothing built for this posting yet.';

  const tone = working ? 'ai' : status.kind === 'error' ? 'bad' : result ? 'ok' : 'neutral';

  return (
    <Step
      index={index}
      title="Tailor the documents"
      status={status_line}
      tone={tone}
      done={Boolean(result) && !working}
      action={
        result && !working ? (
          <button type="button" className="btn btn-primary" onClick={() => void openReview()}>
            Open review
          </button>
        ) : undefined
      }
    >
      {/*
        The build controls. Separate elements from the row above, which is why
        reading the result no longer risks paying for another one.
      */}
      <div className="step-choices">
        {(['resume', 'letter', 'both'] as const).map((what) => (
          <button
            key={what}
            type="button"
            className="btn"
            disabled={working}
            onClick={() => void build(what)}
          >
            {result ? `Rebuild ${LABELS[what].toLowerCase()}` : LABELS[what]}
            <span className="build-cost">
              {REQUESTS[what]} request{REQUESTS[what] === 1 ? '' : 's'}
            </span>
          </button>
        ))}
      </div>

      <p className="hint">
        Nothing is sent until you press one. With a tailoring bank the wording is picked on this machine for
        nothing and only the ranking costs a request; without one the bullets are written for this posting
        instead, which is the same single request. A letter is one more.
      </p>

      {status.kind === 'error' && status.message.includes('bank') && (
        <button type="button" className="btn-plain" onClick={() => onOpenSetup('documents', 'bank')}>
          Generate a tailoring bank
        </button>
      )}
    </Step>
  );
}
