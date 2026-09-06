import { useState } from 'react';
import { ActionRow } from '@/components/ActionRow';
import { KeywordChips, ScoreRing, verdictFor } from '@/components/ScoreRing';
import { DraftIcon } from '@/components/icons';
import { tailorResume, writeCoverLetter, type CoverLetterResult, type TailorResult } from '@/lib/tailor-run';
import {
  assembleCoverLetter,
  combinedFilename,
  combinedToDocxBlob,
  coverLetterFilename,
  coverLetterToDocxBlob,
  resumeFilename,
  toDocxBlob,
} from '@/lib/resume-document';
import { ensureReadPermission, getDocumentsFolderHandle, saveToDocumentsFolder } from '@/lib/document-store';
import { readJobInfo } from '@/lib/active-tab';
import { getActiveTabId } from '@/lib/active-tab';
import { openReviewTab, putReview } from '@/lib/review-handoff';
import type { Posting } from '@/components/JobContext';
import type { OpenSetup } from '@/components/panel-types';
import type { LetterLanguage } from '@/lib/letter-language';
import { getProfile } from '@/lib/storage';

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'ready'; result: TailorResult; jobDescription: string }
  | { kind: 'saved'; filenames: string[] }
  | { kind: 'error'; message: string };

/**
 * Builds a resume for the posting in front of you.
 *
 * The document is always shown before it is saved. It is assembled from
 * sentences already in the bank, so nothing here is newly written — but the
 * user still decides what leaves the extension, exactly as they do for a
 * drafted answer or a filled field.
 */
export function TailorCard({ posting, onOpenSetup }: { posting: Posting; onOpenSetup: OpenSetup }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [closed, setClosed] = useState(false);

  const build = async () => {
    setStatus({ kind: 'working' });
    try {
      const tabId = await getActiveTabId();
      const info = await readJobInfo(tabId);

      const jobDescription = info?.jobDescription ?? '';
      const result = await tailorResume({ jobDescription });
      setStatus({ kind: 'ready', result, jobDescription });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not build a resume.' });
    }
  };

  const [letter, setLetter] = useState<CoverLetterResult | null>(null);
  const [writingLetter, setWritingLetter] = useState(false);
  const [needsCompany, setNeedsCompany] = useState(false);

  /** `language` overrides detection, which is a coin flip on a bilingual posting. */
  const write = async (language?: LetterLanguage) => {
    if (status.kind !== 'ready') return;
    setWritingLetter(true);
    try {
      setLetter(
        await writeCoverLetter({
          jobDescription: status.jobDescription,
          company: posting.company,
          role: posting.role,
          resumeBullets: status.result.selected,
          language,
        })
      );
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not write a letter.' });
    } finally {
      setWritingLetter(false);
    }
  };

  /**
   * Plenty of postings have one upload slot and no second field for a letter.
   * Saving them combined is the only thing that fits, and it is what people
   * already do by hand.
   */
  const [combine, setCombine] = useState(false);

  const save = async () => {
    if (status.kind !== 'ready') return;
    // A company-less filename collides with the last one and is invisible to
    // the attach step, which finds documents by scanning names for the company.
    if (!posting.company.trim()) {
      setNeedsCompany(true);
      return;
    }
    try {
      const handle = await getDocumentsFolderHandle();
      if (!handle) {
        setStatus({ kind: 'error', message: 'Link a documents folder in Settings first.' });
        return;
      }
      if (!(await ensureReadPermission(handle))) {
        setStatus({ kind: 'error', message: 'Folder access was not granted.' });
        return;
      }

      const saved: string[] = [];

      if (combine && letter) {
        const document = assembleCoverLetter({
          profile: await getProfile(),
          company: posting.company,
          role: posting.role,
          body: letter.text,
          language: letter.language,
        });
        saved.push(
          await saveToDocumentsFolder(
            handle,
            combinedFilename(status.result.document, posting.company),
            await combinedToDocxBlob(status.result.document, document)
          )
        );
        setStatus({ kind: 'saved', filenames: saved });
        return;
      }

      saved.push(
        await saveToDocumentsFolder(
          handle,
          resumeFilename(status.result.document, posting.company),
          await toDocxBlob(status.result.document)
        )
      );

      // Saved as a pair when a letter exists, so they sit together and the
      // attach path finds both by company name.
      if (letter) {
        saved.push(
          await saveToDocumentsFolder(
            handle,
            coverLetterFilename(status.result.document, posting.company),
            await coverLetterToDocxBlob(
              assembleCoverLetter({
                profile: await getProfile(),
                company: posting.company,
                role: posting.role,
                body: letter.text,
                language: letter.language,
              })
            )
          )
        );
      }

      // Now in the documents folder, so Attach documents finds them like any other.
      setStatus({ kind: 'saved', filenames: saved });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not save the file.' });
    }
  };

  const result = status.kind === 'ready' ? status.result : null;
  // Nothing was scraped from the page, so there is nothing to match against.
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
        title="Tailor a resume"
        description="Picks the best version of each achievement for this posting."
        tint="green"
        onClick={build}
        disabled={status.kind === 'working'}
        collapsed={closed}
        onToggleCollapse={() => setClosed((v) => !v)}
      >
        {status.kind === 'working' && <span className="pill pill-neutral">Choosing…</span>}
        {status.kind === 'error' && <span className="pill pill-danger">{status.message}</span>}
        {status.kind === 'saved' && (
          <span className="pill pill-success">
            Saved {status.filenames.length === 1 ? status.filenames[0] : `${status.filenames.length} files`}
          </span>
        )}
        {result && (
          <>
            <span className={`pill ${verdictFor(result.score) === 'weak' ? 'pill-danger' : verdictFor(result.score) === 'fair' ? 'pill-warning' : 'pill-success'}`}>
              {result.score}
            </span>
            {result.offline && <span className="pill pill-neutral">no AI</span>}
          </>
        )}
      </ActionRow>

      {!closed && status.kind === 'error' && status.message.includes('bank') && (
        <button type="button" className="btn-plain" onClick={() => onOpenSetup('documents', 'bank')}>
          Generate a tailoring bank
        </button>
      )}

      {!closed && result && status.kind === 'ready' && (
        <div className="tailor-preview">
          {letter && (
            <label className="field checkbox">
              <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} />
              <span>Save as one file, letter first</span>
            </label>
          )}
          {letter && combine && (
            <p className="hint">
              For a form with a single upload slot. Attaching only the resume throws the letter away.
            </p>
          )}

          {needsCompany ? (
            <p className="error">
              Add the company at the top of the panel before saving. It names both files, and Attach documents
              finds them by it.
            </p>
          ) : (
            <p className="hint">
              Saves as{' '}
              {combine && letter
                ? combinedFilename(result.document, posting.company)
                : resumeFilename(result.document, posting.company)}
            </p>
          )}

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
              Dashed means the posting asks and your profile never mentions it. Tailoring reorders what you have;
              it cannot cover a gap.
            </p>
          )}

          {untailored.length > 0 && (
            <div className="notice notice-warning">
              <p>
                The bank has nothing for <strong>{untailored.join(', ')}</strong>, so your own wording is used
                there. Nothing is missing from the resume — those parts are just not tailored to this posting.
              </p>
            </div>
          )}

          {result.document.experience.concat(result.document.projects).map((section) => (
            <div className="tailor-section" key={section.heading}>
              <p className="tailor-heading">
                {section.heading}
                {section.meta && <span className="hint"> · {section.meta}</span>}
                {!section.tailored && <span className="pill pill-neutral">your wording</span>}
              </p>
              <ul>
                {section.bullets.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          ))}

          {letter && (
            <div className="tailor-letter">
              <p className="tailor-heading">Cover letter</p>
              <p className="status-row">
                <span className="pill pill-neutral">{letter.language === 'de' ? 'German' : 'English'}</span>
                {letter.faults.map((fault) => (
                  <span key={fault.kind} className="pill pill-warning" title={fault.detail}>
                    {fault.kind.replace(/-/g, ' ')}
                  </span>
                ))}
                <button
                  type="button"
                  className="btn-plain"
                  disabled={writingLetter}
                  onClick={() => void write(letter.language === 'de' ? 'en' : 'de')}
                >
                  {writingLetter
                    ? 'Rewriting…'
                    : `Rewrite in ${letter.language === 'de' ? 'English' : 'German'}`}
                </button>
              </p>
              <textarea
                className="tailor-letter-text"
                aria-label="Cover letter body"
                value={letter.text}
                onChange={(e) => setLetter({ ...letter, text: e.target.value })}
              />
            </div>
          )}

          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={async () => {
                if (status.kind !== 'ready') return;
                // Editing a resume in a 400px panel is not reviewing it.
                await putReview({
                  result: status.result,
                  letter,
                  company: posting.company,
                  role: posting.role,
                  jobDescription: status.jobDescription,
                });
                await openReviewTab();
              }}
            >
              Review in a tab
            </button>
            {!letter && (
              <button type="button" className="btn" disabled={writingLetter} onClick={() => void write()}>
                {writingLetter ? 'Writing…' : 'Write a cover letter'}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={save}>
              Save to documents folder
            </button>
          </div>
        </div>
      )}
    </>
  );
}
