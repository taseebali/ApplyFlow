import { useState } from 'react';
import { ActionRow } from '@/components/ActionRow';
import { KeywordChips, ScoreRing, verdictFor } from '@/components/ScoreRing';
import { DraftIcon } from '@/components/icons';
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
 * is paid. Selecting from the bank is local and free; ranking the shortlist and
 * writing a letter are one request each, and a letter on its own skips the
 * ranking because it does not read the ordering.
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
export function TailorCard({ posting, onOpenSetup }: { posting: Posting; onOpenSetup: OpenSetup }) {
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
  const asked = result ? result.gap.covered.length + result.gap.missing.length : 0;
  // Sections that fell back to the user's own bullets because the bank had
  // nothing for them — worth saying, since the resume looks complete either way.
  const untailored = result
    ? result.document.experience
        .concat(result.document.projects)
        .filter((section) => !section.tailored)
        .map((section) => section.heading)
    : [];

  return (
    <>
      <ActionRow
        icon={<DraftIcon />}
        title="Tailor this application"
        description="Choose what to build for this posting."
        tint="green"
        // The row opens rather than runs. Clicking it used to spend requests.
        onClick={() => setClosed((v) => !v)}
        collapsed={closed}
        onToggleCollapse={() => setClosed((v) => !v)}
      >
        {status.kind === 'working' && <span className="pill pill-neutral">Writing {LABELS[status.what]}…</span>}
        {status.kind === 'error' && <span className="pill pill-danger">{status.message}</span>}
        {result && (
          <>
            <span
              className={`pill ${
                verdictFor(result.score) === 'weak'
                  ? 'pill-danger'
                  : verdictFor(result.score) === 'fair'
                    ? 'pill-warning'
                    : 'pill-success'
              }`}
            >
              {result.score}
            </span>
            {result.offline && <span className="pill pill-neutral">no AI</span>}
          </>
        )}
      </ActionRow>

      {!closed && (
        <div className="tailor-preview">
          <div className="build-choices">
            {(['resume', 'letter', 'both'] as const).map((what) => (
              <button
                key={what}
                type="button"
                className={`btn ${what === 'resume' ? 'btn-primary' : ''}`}
                disabled={status.kind === 'working'}
                onClick={() => void build(what)}
              >
                {LABELS[what]}
                <span className="build-cost">
                  {REQUESTS[what]} request{REQUESTS[what] === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
          <p className="hint">
            Nothing is sent until you choose. Picking the wording for a resume happens on this machine and costs
            nothing; ranking it for this posting and writing a letter are one request each.
          </p>

          {status.kind === 'error' && status.message.includes('bank') && (
            <button type="button" className="btn-plain" onClick={() => onOpenSetup('documents', 'bank')}>
              Generate a tailoring bank
            </button>
          )}

          {result && (
            <>
              <ScoreRing
                score={result.score}
                detail={
                  asked > 0
                    ? `${result.gap.covered.length} of ${asked} things the posting asks for`
                    : 'Writing quality only. No posting text to compare against.'
                }
              />
              {asked > 0 && (
                <KeywordChips
                  covered={result.gap.covered.slice(0, 8).map((g) => g.term)}
                  missing={result.gap.missing.map((g) => g.term)}
                />
              )}
              {result.gap.missing.length > 0 && (
                <p className="hint">
                  Dashed means the posting asks and your profile never mentions it. Tailoring reorders what you
                  have; it cannot cover a gap.
                </p>
              )}

              {untailored.length > 0 && (
                <div className="notice notice-warning">
                  <p>
                    The bank has nothing for <strong>{untailored.join(', ')}</strong>, so your own wording is
                    used there. Nothing is missing from the resume — those parts are just not tailored to this
                    posting.
                  </p>
                </div>
              )}

              {/* Saving happens where the document is visible. Doing it from
                  here meant saving a file nobody had seen. */}
              <div className="actions">
                <button type="button" className="btn btn-primary" onClick={() => void openReview()}>
                  Open it to review and save
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
