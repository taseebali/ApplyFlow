import { useState } from 'react';
import { ActionCard } from '@/components/ActionCard';
import { TextField } from '@/components/ProfileForm';
import { DraftIcon } from '@/components/icons';
import { tailorResume, writeCoverLetter, type CoverLetterResult, type TailorResult } from '@/lib/tailor-run';
import {
  assembleCoverLetter,
  coverLetterFilename,
  coverLetterToDocxBlob,
  resumeFilename,
  toDocxBlob,
} from '@/lib/resume-document';
import { ensureReadPermission, getDocumentsFolderHandle, saveToDocumentsFolder } from '@/lib/document-store';
import type { GetJobInfoMessage, GetJobInfoResponse } from '@/entrypoints/content';
import { getActiveTabId } from './DailyView';
import { openReviewTab, putReview } from '@/lib/review-handoff';
import type { LetterLanguage } from '@/lib/letter-language';
import { getProfile } from '@/lib/storage';

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'ready'; result: TailorResult; company: string; role: string; jobDescription: string }
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
export function TailorCard({ onOpenSetup }: { onOpenSetup: () => void }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [closed, setClosed] = useState(false);

  const build = async () => {
    setStatus({ kind: 'working' });
    try {
      const tabId = await getActiveTabId();
      const info: GetJobInfoResponse = await browser.tabs.sendMessage(tabId, {
        type: 'get-job-info',
      } satisfies GetJobInfoMessage);

      const jobDescription = info.jobDescription ?? '';
      const result = await tailorResume({ jobDescription });
      setStatus({
        kind: 'ready',
        result,
        company: info.companyName ?? '',
        role: info.jobTitle ?? '',
        jobDescription,
      });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not build a resume.' });
    }
  };

  const [letter, setLetter] = useState<CoverLetterResult | null>(null);
  const [writingLetter, setWritingLetter] = useState(false);
  const [needsCompany, setNeedsCompany] = useState(false);

  /** Detection misses; typing the company must always be possible. */
  const setPosting = (patch: { company?: string; role?: string }) =>
    setStatus((current) => (current.kind === 'ready' ? { ...current, ...patch } : current));

  /** `language` overrides detection, which is a coin flip on a bilingual posting. */
  const write = async (language?: LetterLanguage) => {
    if (status.kind !== 'ready') return;
    setWritingLetter(true);
    try {
      setLetter(
        await writeCoverLetter({
          jobDescription: status.jobDescription,
          company: status.company,
          role: status.role,
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

  const save = async () => {
    if (status.kind !== 'ready') return;
    // A company-less filename collides with the last one and is invisible to
    // the attach step, which finds documents by scanning names for the company.
    if (!status.company.trim()) {
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

      saved.push(
        await saveToDocumentsFolder(
          handle,
          resumeFilename(status.result.document, status.company),
          await toDocxBlob(status.result.document)
        )
      );

      // Saved as a pair when a letter exists, so they sit together and the
      // attach path finds both by company name.
      if (letter) {
        saved.push(
          await saveToDocumentsFolder(
            handle,
            coverLetterFilename(status.result.document, status.company),
            await coverLetterToDocxBlob(
              assembleCoverLetter({
                profile: await getProfile(),
                company: status.company,
                role: status.role,
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
      <ActionCard
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
            <span className={`pill ${result.score >= 80 ? 'pill-success' : 'pill-warning'}`}>
              {result.score}/100
            </span>
            {result.offline && <span className="pill pill-neutral">ordered without AI</span>}
          </>
        )}
      </ActionCard>

      {!closed && status.kind === 'error' && status.message.includes('bank') && (
        <button type="button" className="btn-plain" onClick={onOpenSetup}>
          Open Settings
        </button>
      )}

      {!closed && result && status.kind === 'ready' && (
        <div className="tailor-preview">
          <div className="grid">
            <TextField
              label="Company"
              required
              value={status.company}
              onChange={(v) => {
                setPosting({ company: v });
                setNeedsCompany(false);
              }}
            />
            <TextField label="Role" value={status.role} onChange={(v) => setPosting({ role: v })} />
          </div>
          {needsCompany ? (
            <p className="error">
              Add the company before saving. It names both files, and Attach documents finds them by it.
            </p>
          ) : (
            <p className="hint">
              Names both files — {resumeFilename(result.document, status.company)}
            </p>
          )}

          {result.gap.missing.length > 0 && (
            <div className="notice notice-warning">
              <p>
                This posting asks for <strong>{result.gap.missing.map((g) => g.term).join(', ')}</strong> and nothing
                in your profile mentions {result.gap.missing.length === 1 ? 'it' : 'them'}. Tailoring can reorder what
                you have; it cannot cover a gap.
              </p>
            </div>
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
                value={letter.text}
                onChange={(e) => setLetter({ ...letter, text: e.target.value })}
              />
            </div>
          )}

          <div className="tailor-actions">
            <button
              type="button"
              className="btn"
              onClick={async () => {
                if (status.kind !== 'ready') return;
                // Editing a resume in a 400px panel is not reviewing it.
                await putReview({
                  result: status.result,
                  letter,
                  company: status.company,
                  role: status.role,
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
