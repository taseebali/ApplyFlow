import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { takeReview, type ReviewHandoff } from '@/lib/review-handoff';
import { getBank, reviseVariant, setBank, type BulletVariant } from '@/lib/bullet-bank';
import { scoreSection } from '@/lib/bullet-quality';
import { coverLetterFaults } from '@/lib/cover-letter';
import {
  assembleCoverLetter,
  assembleResume,
  combinedFilename,
  combinedToDocxBlob,
  coverLetterFilename,
  coverLetterToDocxBlob,
  resumeFilename,
  toDocxBlob,
} from '@/lib/resume-document';
import { getProfile } from '@/lib/storage';
import { useStoredTheme } from '@/components/ThemeControl';
import { KeywordChips, ScoreRing } from '@/components/ScoreRing';
import { LetterPage, ResumePage } from '@/components/ResumePage';
import { ensureReadPermission, getDocumentsFolderHandle, saveToDocumentsFolder } from '@/lib/document-store';
import type { Profile } from '@/lib/schema';

/**
 * The tailored application, as the page it will be.
 *
 * This used to be a form describing the document — a column of textareas and
 * status pills — so the resume itself was never visible until it had been
 * saved and opened in Word. Every fault in the first real one was found that
 * way. Now the document is on the right at the size it prints, editable in
 * place, and the rail on the left holds only what typing cannot do.
 */

/**
 * A4 at 96dpi, less the one-inch margins the export uses. The preview cannot
 * be pixel-identical to Word's line breaking, so the rule is drawn a little
 * early and the trim aims under it: overshooting onto a second page is the
 * failure that matters, and a slightly short page is not a failure at all.
 */
const PAGE_CONTENT_PX = 931;
const FITS_UNDER = 0.94;

/** Where trimming starts. It comes down from here until the page fits. */
const START_PROJECTS = 6;

export function ReviewPage() {
  const [handoff, setHandoff] = useState<ReviewHandoff | null>(null);
  const [company, setCompany] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bullets, setBullets] = useState<BulletVariant[]>([]);
  const [letter, setLetter] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const [showing, setShowing] = useState<'resume' | 'letter'>('resume');
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [kept, setKept] = useState(false);
  const [combine, setCombine] = useState(false);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxProjects, setMaxProjects] = useState(START_PROJECTS);
  const pageRef = useRef<HTMLDivElement>(null);
  useStoredTheme();

  useEffect(() => {
    void takeReview().then((data) => {
      setHandoff(data);
      setCompany(data?.company ?? '');
      setBullets(data?.result.selected ?? []);
      setLetter(data?.letter?.text ?? '');
    });
    void getProfile().then(setProfile);
  }, []);

  const document =
    profile && handoff
      ? assembleResume(
          summary === null ? profile : { ...profile, summary },
          bullets,
          handoff.jobDescription,
          maxProjects
        )
      : null;

  /*
   * One page, by measuring rather than by guessing.
   *
   * The cap used to be a constant four projects, applied whether they were one
   * line or six and whether or not a summary, a skills block and a languages
   * line sat above them. A constant cannot hold a page. This drops the
   * lowest-ranked project until the rendered content clears the rule, which is
   * the same question the reader's printer asks.
   */
  useLayoutEffect(() => {
    const element = pageRef.current;
    if (!element || showing !== 'resume') return;
    if (element.scrollHeight > PAGE_CONTENT_PX * FITS_UNDER && maxProjects > 1) {
      setMaxProjects((current) => current - 1);
    }
  }, [maxProjects, bullets, summary, showing]);

  // Editing can only ever shorten or lengthen the page, so the trim starts
  // over rather than staying where an earlier, longer draft left it.
  useEffect(() => setMaxProjects(START_PROJECTS), [bullets.length, profile]);

  if (!handoff || !profile || !document) {
    return (
      <main className="review">
        <p className="hint">
          Nothing to review. Build a resume from the side panel on a job posting, then open it here.
        </p>
      </main>
    );
  }

  /**
   * Bullets are addressed on the page by section and position, which is what
   * the document exposes; mapping back to the variant that produced the text
   * is what lets an edit reach the bank.
   */
  const editBullet = (kind: 'experience' | 'projects', section: number, index: number, text: string) => {
    const old = document[kind][section]?.bullets[index];
    if (old === undefined) return;
    const variant = bullets.find((b) => b.text === old);
    if (!variant) return;
    setBullets((current) => current.map((b) => (b.id === variant.id ? { ...b, text } : b)));
    setEdited((current) => new Set(current).add(variant.id));
    setKept(false);
  };

  /** Writes every edited wording back, so the next application starts from it. */
  const keepEdits = async () => {
    const bank = await getBank();
    if (!bank) return;
    let next = bank;
    for (const variant of bullets) {
      if (edited.has(variant.id)) next = reviseVariant(next, variant.id, variant.text);
    }
    await setBank(next);
    setKept(true);
  };

  const score = scoreSection(bullets.map((b) => b.text)).score;
  const asked = handoff.result.gap.covered.length + handoff.result.gap.missing.length;

  const letterDocument = letter.trim()
    ? assembleCoverLetter({
        profile,
        company,
        role: handoff.role,
        body: letter,
        language: handoff.letter?.language ?? 'en',
      })
    : null;

  const letterFaults = letterDocument
    ? coverLetterFaults(letter, bullets.map((b) => b.text), { company, role: handoff.role })
    : [];

  const overflowing = (pageRef.current?.scrollHeight ?? 0) > PAGE_CONTENT_PX;

  // Every figure on the page that came from the model rather than the profile.
  const estimates = [...new Set(bullets.flatMap((variant) => variant.estimated ?? []))];

  const save = async () => {
    setError(null);
    if (!company.trim()) {
      setError('Add the company before saving. It names both files, and Attach documents finds them by it.');
      return;
    }
    try {
      const handle = await getDocumentsFolderHandle();
      if (!handle) {
        setError('Link a documents folder in Settings first.');
        return;
      }
      if (!(await ensureReadPermission(handle))) {
        setError('Folder access was not granted.');
        return;
      }

      const names: string[] = [];
      if (combine && letterDocument) {
        // Plenty of postings have one upload slot and no second field for a
        // letter, and this is what people already do by hand.
        names.push(
          await saveToDocumentsFolder(
            handle,
            combinedFilename(document, company),
            await combinedToDocxBlob(document, letterDocument)
          )
        );
      } else {
        names.push(
          await saveToDocumentsFolder(handle, resumeFilename(document, company), await toDocxBlob(document))
        );
        if (letterDocument) {
          names.push(
            await saveToDocumentsFolder(
              handle,
              coverLetterFilename(document, company),
              await coverLetterToDocxBlob(letterDocument)
            )
          );
        }
      }
      setSaved(names);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  };

  return (
    <main className="review">
      <div className="review-rail">
        <p className="eyebrow">Review before sending</p>
        <h1>{[handoff.role, company].filter(Boolean).join(' · ') || 'Tailored application'}</h1>

        <label className="field">
          <span>Company</span>
          <input
            type="text"
            value={company}
            placeholder="Enpal"
            onChange={(event) => setCompany(event.target.value)}
          />
        </label>

        <ScoreRing
          score={score}
          detail={
            asked > 0
              ? `${handoff.result.gap.covered.length} of ${asked} things the posting asks for`
              : 'Writing quality only. No posting text to compare against.'
          }
        />

        {asked > 0 && (
          <section>
            <h2>Match</h2>
            <KeywordChips
              covered={handoff.result.gap.covered.slice(0, 12).map((g) => g.term)}
              missing={handoff.result.gap.missing.map((g) => g.term)}
            />
            {handoff.result.gap.missing.length > 0 && (
              <p className="hint mt-2">
                Dashed means the posting asks and your profile never mentions it. Tailoring reorders what you
                have; it cannot cover a gap.
              </p>
            )}
          </section>
        )}

        {estimates.length > 0 && (
          <section>
            <h2>Estimated figures</h2>
            <p className="hint">
              {estimates.length} number{estimates.length === 1 ? '' : 's'} on this resume was worked out from
              what your profile describes rather than read from it: {estimates.join(', ')}. Each is marked on
              the page. Confirm or correct them before you send it — a figure on a resume is one you have to
              defend in an interview.
            </p>
          </section>
        )}

        <section>
          <h2>The page</h2>
          <p className={`pill ${overflowing ? 'pill-warning' : 'pill-success'}`}>
            {overflowing ? 'Runs onto a second page' : 'Fits on one page'}
          </p>
          {document.omitted.length > 0 && (
            <p className="hint mt-2">
              Left off to keep this to a page: {document.omitted.join(', ')}. Lowest-ranked first — relevance to
              the posting, then how much each has to say.
            </p>
          )}
        </section>

        {letterDocument && (
          <section>
            <h2>Cover letter</h2>
            <div className="status-row">
              <span className="pill pill-neutral">{letterDocument.language === 'de' ? 'German' : 'English'}</span>
              {letterFaults.map((fault) => (
                <span key={fault.kind} className="pill pill-warning" title={fault.detail}>
                  {fault.kind.replace(/-/g, ' ')}
                </span>
              ))}
            </div>
            <label className="field checkbox mt-2">
              <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} />
              <span>Save as one file — for forms with a single upload slot</span>
            </label>
          </section>
        )}

        {edited.size > 0 && (
          <section>
            <h2>Your edits</h2>
            <p className="hint">
              {edited.size} line{edited.size === 1 ? '' : 's'} changed. Keeping them means the next application
              starts from your wording rather than the generated one.
            </p>
            <button type="button" className="btn" disabled={kept} onClick={() => void keepEdits()}>
              {kept ? 'Kept for next time' : 'Keep my wording'}
            </button>
          </section>
        )}

        {error && <p className="error">{error}</p>}
        {saved && (
          <p className="status-row">
            <span className="pill pill-success">Saved {saved.join(', ')}</span>
          </p>
        )}

        <button type="button" className="btn btn-primary" onClick={() => void save()}>
          Save to documents folder
        </button>
      </div>

      <div className="review-doc">
        {letterDocument && (
          <div className="doc-tabs" role="tablist">
            {(['resume', 'letter'] as const).map((view) => (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={showing === view}
                className={`doc-tab ${showing === view ? 'doc-tab-on' : ''}`}
                onClick={() => setShowing(view)}
              >
                {view === 'resume' ? 'Resume' : 'Cover letter'}
              </button>
            ))}
          </div>
        )}

        <div className="doc-sheet">
          <div className="doc-body" ref={pageRef}>
            {showing === 'resume' || !letterDocument ? (
              <ResumePage
                document={document}
                onEditBullet={editBullet}
                onEditSummary={(text) => setSummary(text)}
              />
            ) : (
              <LetterPage letter={letterDocument} body={letter} onEditBody={setLetter} />
            )}
          </div>
          {/* Where the first page ends. Anything below it is a second page. */}
          <div className="doc-page-rule" aria-hidden="true" />
        </div>
      </div>
    </main>
  );
}
