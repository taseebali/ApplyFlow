import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { takeReview, type ReviewHandoff } from '@/lib/review-handoff';
import { getBank, reviseVariant, setBank, type BulletVariant } from '@/lib/bullet-bank';
import { scoreSection } from '@/lib/bullet-quality';
import { coverLetterFaults } from '@/lib/cover-letter';
import type { CoverLetterDocument, HeadingKey, ResumeDocument } from '@/lib/resume-document';
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
import { LetterPage, ResumePage, type EditableField } from '@/components/ResumePage';
import { DocumentStyleBar } from '@/components/DocumentStyleBar';
import {
  contentBudgetPx,
  DEFAULT_STYLE,
  fontStack,
  getDocumentStyle,
  marginPx,
  setDocumentStyle,
  sizePx,
  type DocumentStyle,
} from '@/lib/document-style';
import { ensureReadPermission, getDocumentsFolderHandle, saveToDocumentsFolder } from '@/lib/document-store';
import { documentFromBlob } from '@/lib/application-record';
import { patchRecord } from '@/lib/application-db';
import { getTabState } from '@/lib/tab-state';
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
 * The preview cannot be pixel-identical to Word's line breaking, so the rule
 * is drawn a little early and the trim aims under it: overshooting onto a
 * second page is the failure that matters, and a slightly short page is not a
 * failure at all.
 *
 * The budget itself now comes from the chosen margin rather than a constant —
 * narrowing the margins really does buy room, and the trim has to know it.
 */
const FITS_UNDER = 0.97;

/** Where trimming starts. It comes down from here until the page fits. */
const START_PROJECTS = 8;

/**
 * The trim stops here even if the page still spills.
 *
 * A resume with one project is not a resume, and that is what the first
 * version produced: it measured the padded container rather than the content
 * inside it, so 192px of page margin counted against a 931px budget and it cut
 * everything but the top-ranked project. The measurement is fixed, and this is
 * the floor that keeps the failure from being silent — the rail says the page
 * spills rather than gutting the document to hide it.
 */
const MIN_PROJECTS = 3;

/**
 * The chosen settings, handed to the page as CSS custom properties.
 *
 * The sheet is built from these rather than from fixed pixel values, so every
 * size on it — the name, the section rules, the bullets — scales with the body
 * size, and the page-end rule moves with the margin. One source for what the
 * screen shows and what the .docx contains.
 */
function sheetVariables(style: DocumentStyle): CSSProperties {
  return {
    '--doc-font': fontStack(style.font),
    '--doc-size': `${sizePx(style.size)}px`,
    '--doc-line': String(style.line),
    '--doc-margin': `${marginPx(style.margin)}px`,
  } as CSSProperties;
}

export function ReviewPage() {
  const [handoff, setHandoff] = useState<ReviewHandoff | null>(null);
  const [company, setCompany] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bullets, setBullets] = useState<BulletVariant[]>([]);
  const [letter, setLetter] = useState('');
  /**
   * Edits to the document that are not bullets, held over the assembled
   * document rather than written back into the profile: the profile is the
   * master and this is one application's copy of it.
   */
  const [edits, setEdits] = useState<Partial<ResumeDocument>>({});
  const [showing, setShowing] = useState<'resume' | 'letter'>('resume');
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [kept, setKept] = useState(false);
  const [combine, setCombine] = useState(false);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxProjects, setMaxProjects] = useState(START_PROJECTS);
  const [style, setStyle] = useState<DocumentStyle>(DEFAULT_STYLE);
  /**
   * Edits to the letter's furniture — recipient, date, subject, sign-off.
   * Held over the assembled letter for the same reason the resume's are held
   * over the assembled resume: the profile is the master, and this is one
   * application's copy.
   */
  const [letterEdits, setLetterEdits] = useState<Partial<CoverLetterDocument>>({});
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
    void getDocumentStyle().then(setStyle);
  }, []);

  // Written back on every change, so the font someone picks is the font the
  // next application opens in rather than a setting they re-choose each time.
  const changeStyle = (next: DocumentStyle) => {
    setStyle(next);
    void setDocumentStyle(next);
  };

  const pageBudget = contentBudgetPx(style.margin);

  const assembled =
    profile && handoff ? assembleResume(profile, bullets, handoff.jobDescription, maxProjects) : null;

  // Applied on top, so trimming a project or swapping a bullet never discards
  // a line the user retyped.
  const document = assembled ? ({ ...assembled, ...edits } as typeof assembled) : null;

  const editField = (field: EditableField, text: string, index?: number) => {
    setEdits((current) => {
      if (!assembled) return current;
      // `skillLabel` never reaches here: it always carries an index and is
      // handled with the rest of the skills line below.
      if (index === undefined) return { ...current, [field]: text } as Partial<ResumeDocument>;

      // Both halves of a skills line — the group's name and its terms — land
      // on the same `skills` array, so they are handled together.
      if (field === 'skills' || field === 'skillLabel') {
        const groups = current.skills ?? assembled.skills;
        return {
          ...current,
          skills: groups.map((group, i) => {
            if (i !== index) return group;
            if (field === 'skillLabel') return { ...group, label: text };
            return { ...group, items: text.split(',').map((t) => t.trim()).filter(Boolean) };
          }),
        };
      }

      const key = field as 'education' | 'certifications';
      const lines = (current[key] ?? assembled[key]).slice();
      lines[index] = text;
      return { ...current, [key]: lines };
    });
  };

  /*
   * One page, by measuring rather than by guessing.
   *
   * The cap used to be a constant four projects, applied whether they were one
   * line or six and whether or not a summary, a skills block and a languages
   * line sat above them. A constant cannot hold a page. This drops the
   * lowest-ranked project until the rendered content clears the rule, which is
   * the same question the reader's printer asks.
   */
  const editSection = (
    kind: 'experience' | 'projects',
    index: number,
    field: 'heading' | 'meta' | 'link',
    text: string
  ) => {
    setEdits((current) => {
      if (!assembled) return current;
      const list = current[kind] ?? assembled[kind];
      return {
        ...current,
        [kind]: list.map((section, i) => (i === index ? { ...section, [field]: text } : section)),
      };
    });
  };

  const editHeading = (key: HeadingKey, text: string) => {
    setEdits((current) => ({
      ...current,
      headings: { ...(current.headings ?? {}), [key]: text },
    }));
  };

  useLayoutEffect(() => {
    const element = pageRef.current;
    if (!element || showing !== 'resume') return;
    // The article, not the sheet around it: the sheet carries the page margin
    // as padding, and scrollHeight includes padding, so measuring it charged
    // 192px of margin against the content budget and over-trimmed by a quarter.
    const content = element.querySelector('.doc');
    const height = content?.scrollHeight ?? element.scrollHeight;
    if (height > pageBudget * FITS_UNDER && maxProjects > MIN_PROJECTS) {
      setMaxProjects((current) => current - 1);
    }
  }, [maxProjects, bullets, edits, showing, pageBudget]);

  // Editing can only ever shorten or lengthen the page, so the trim starts
  // over rather than staying where an earlier, longer draft left it. A larger
  // font or a wider margin is the same question asked again.
  useEffect(() => setMaxProjects(START_PROJECTS), [bullets.length, profile, style]);

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

  const assembledLetter = letter.trim()
    ? assembleCoverLetter({
        profile,
        company,
        role: handoff.role,
        body: letter,
        language: handoff.letter?.language ?? 'en',
      })
    : null;

  // Same rule as the resume: retyped lines sit on top of the assembled ones,
  // so changing the company below does not discard a salutation someone fixed.
  const letterDocument = assembledLetter ? { ...assembledLetter, ...letterEdits } : null;

  const letterFaults = letterDocument
    ? coverLetterFaults(letter, bullets.map((b) => b.text), { company, role: handoff.role })
    : [];

  const overflowing = (pageRef.current?.querySelector('.doc')?.scrollHeight ?? 0) > pageBudget;

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
      // Held rather than passed straight through: the same bytes that go to the
      // documents folder go onto the record, and building them twice would let
      // the two copies drift.
      let resumeBlob: Blob | null = null;
      let letterBlob: Blob | null = null;

      if (combine && letterDocument) {
        // Plenty of postings have one upload slot and no second field for a
        // letter, and this is what people already do by hand.
        const combinedBlob = await combinedToDocxBlob(document, letterDocument, style);
        resumeBlob = combinedBlob;
        names.push(
          await saveToDocumentsFolder(handle, combinedFilename(document, company), combinedBlob)
        );
      } else {
        resumeBlob = await toDocxBlob(document, style);
        names.push(await saveToDocumentsFolder(handle, resumeFilename(document, company), resumeBlob));

        if (letterDocument) {
          letterBlob = await coverLetterToDocxBlob(letterDocument, style);
          names.push(
            await saveToDocumentsFolder(handle, coverLetterFilename(document, company), letterBlob)
          );
        }
      }
      setSaved(names);

      /*
       * The record is the point of saving, not a side effect of it. Everything
       * that made this application what it is — the posting, the score, the
       * bullets that went out, the figures that were estimated, and both files
       * as bytes — is written here, where all of it is in hand at once.
       */
      const tabId = handoff.tabId;
      const applicationId = tabId === undefined ? undefined : (await getTabState(tabId)).applicationId;
      if (applicationId) {
        // Guarded on its own: the files are already on disk by this point, so
        // a failure here is not a failed save and must not be reported as one.
        try {
          await patchRecord(applicationId, {
            jobDescription: handoff.jobDescription,
            matchScore: score,
            gapCovered: handoff.result.gap.covered.map((g) => g.term),
            gapMissing: handoff.result.gap.missing.map((g) => g.term),
            variantIds: bullets.map((b) => b.id),
            estimatedFigures: estimates,
            resume: resumeBlob ? await documentFromBlob(names[0]!, resumeBlob) : null,
            coverLetter: letterBlob && names[1] ? await documentFromBlob(names[1], letterBlob) : null,
          });
        } catch {
          setError('Saved to your documents folder, but this application could not be added to your history.');
        }
      }
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

        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            Save .docx
          </button>
          {/*
            Printing rather than a PDF library: the sheet on the right is
            already the page at its real size, so the browser's own renderer
            produces exactly what is on screen. A library would re-lay it out
            and disagree with the preview, which is the drift this screen
            exists to remove.
          */}
          <button type="button" className="btn" onClick={() => window.print()}>
            Save PDF
          </button>
        </div>
        <p className="hint">
          .docx goes straight to your documents folder, where Attach finds it. PDF opens your browser's print
          dialog — choose "Save as PDF", and save it to that same folder so Attach can find it too.
        </p>
      </div>

      <div className="review-doc">
        <div className="doc-toolbar">
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
          <DocumentStyleBar style={style} onChange={changeStyle} />
        </div>

        <div className="doc-sheet" style={sheetVariables(style)}>
          <div className="doc-body" ref={pageRef}>
            {showing === 'resume' || !letterDocument ? (
              <ResumePage
                document={document}
                onEditBullet={editBullet}
                onEditSection={editSection}
                onEditHeading={editHeading}
                onEdit={editField}
              />
            ) : (
              <LetterPage
                letter={letterDocument}
                body={letter}
                onEditBody={setLetter}
                onEditLetter={(patch) => setLetterEdits((current) => ({ ...current, ...patch }))}
              />
            )}
          </div>
          {/* Where the first page ends. Anything below it is a second page. */}
          <div className="doc-page-rule" aria-hidden="true" />
        </div>
      </div>
    </main>
  );
}
