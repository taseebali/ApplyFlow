import { useEffect, useState } from 'react';
import { takeReview, type ReviewHandoff } from '@/lib/review-handoff';
import { getBank, reviseVariant, setBank, type BulletVariant } from '@/lib/bullet-bank';
import { scoreBullet, scoreSection } from '@/lib/bullet-quality';
import { coverLetterFaults } from '@/lib/cover-letter';
import {
  assembleCoverLetter,
  coverLetterFilename,
  coverLetterToDocxBlob,
  resumeFilename,
  toDocxBlob,
} from '@/lib/resume-document';
import { assembleResume } from '@/lib/resume-document';
import { getProfile } from '@/lib/storage';
import { useStoredTheme } from '@/components/ThemeControl';
import { KeywordChips, ScoreRing } from '@/components/ScoreRing';
import { ensureReadPermission, getDocumentsFolderHandle, saveToDocumentsFolder } from '@/lib/document-store';
import type { Profile } from '@/lib/schema';

/**
 * The full-width review of one tailored application.
 *
 * A resume cannot be read, let alone edited, in a 400px side panel — and
 * nothing here should leave the extension unreviewed. This is also where the
 * bank improves: an edit made while reviewing is offered back, so the master
 * gets better as a byproduct of applying rather than through a curation chore
 * nobody performs.
 */
export function ReviewPage() {
  const [handoff, setHandoff] = useState<ReviewHandoff | null>(null);
  const [company, setCompany] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bullets, setBullets] = useState<BulletVariant[]>([]);
  const [letter, setLetter] = useState('');
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  if (!handoff || !profile) {
    return (
      <main className="review">
        <p className="hint">
          Nothing to review. Build a resume from the side panel on a job posting, then open it here.
        </p>
      </main>
    );
  }

  const editBullet = (id: string, text: string) => {
    setBullets((current) => current.map((v) => (v.id === id ? { ...v, text } : v)));
    // An edit is no longer the wording the bank holds, so any earlier "keep"
    // no longer describes it.
    setKept((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  /** Writes this wording back to the bank, so every future application uses it. */
  const keepInBank = async (variant: BulletVariant) => {
    const bank = await getBank();
    if (!bank) return;
    await setBank(reviseVariant(bank, variant.id, variant.text));
    setKept((current) => new Set(current).add(variant.id));
  };

  const document = assembleResume(profile, bullets, handoff.jobDescription);
  const score = scoreSection(bullets.map((b) => b.text)).score;
  const letterFaults = coverLetterFaults(letter, bullets.map((b) => b.text), {
    company,
    role: handoff.role,
  });
  // Assembled here too, so what is reviewed is exactly what gets written.
  const letterDocument = letter.trim()
    ? assembleCoverLetter({
        profile,
        company,
        role: handoff.role,
        body: letter,
        language: handoff.letter?.language ?? 'en',
      })
    : null;

  const save = async () => {
    setError(null);
    if (!company.trim()) {
      setError(
        'Add the company before saving. It names both files, and Attach documents finds them by it.'
      );
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
      names.push(
        await saveToDocumentsFolder(handle, resumeFilename(document, company), await toDocxBlob(document))
      );
      if (letter.trim()) {
        names.push(
          await saveToDocumentsFolder(
            handle,
            coverLetterFilename(document, company),
            await coverLetterToDocxBlob(letterDocument!)
          )
        );
      }
      setSaved(names);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  };

  const sections = document.experience.concat(document.projects);
  const asked = handoff.result.gap.covered.length + handoff.result.gap.missing.length;

  return (
    <main className="review">
      <header className="review-head">
        <div>
          <p className="eyebrow">Review before sending</p>
          <h1>{[handoff.role, company].filter(Boolean).join(' · ') || 'Tailored application'}</h1>
          {/* Editable here as well as in the panel: this is the last screen
              before the files are named, and a blank company is what produced
              Jordan_Avery_Resume (5).docx. */}
          <label className="field review-company">
            <span>Company</span>
            <input
              type="text"
              value={company}
              placeholder="Enpal"
              onChange={(event) => setCompany(event.target.value)}
            />
          </label>
        </div>
        <ScoreRing
          score={score}
          detail={
            asked > 0
              ? `${handoff.result.gap.covered.length} of ${asked} things the posting asks for`
              : 'Writing quality only. No posting text to compare against.'
          }
        />
      </header>

      {asked > 0 && (
      <section>
        <h2>Match</h2>
        <KeywordChips
          covered={handoff.result.gap.covered.slice(0, 12).map((g) => g.term)}
          missing={handoff.result.gap.missing.map((g) => g.term)}
        />
        {handoff.result.gap.missing.length > 0 && (
          <p className="hint mt-2">
            Dashed means the posting asks for it and your profile never mentions it. Tailoring reorders what you
            have; it cannot cover a gap.
          </p>
        )}
      </section>
      )}

      <section>
        <h2>Resume</h2>
        {sections.map((section) => {
          const owned = bullets.filter((b) => section.bullets.includes(b.text));
          return (
            <div className="review-section" key={section.heading}>
              <p className="review-heading">
                {section.heading}
                {section.meta && <span className="hint"> · {section.meta}</span>}
                {!section.tailored && <span className="pill pill-neutral">your wording</span>}
              </p>
              {owned.map((variant) => {
                const faults = scoreBullet(variant.text);
                return (
                  <div className="review-bullet" key={variant.id}>
                    <textarea
                      rows={2}
                      aria-label={`Bullet under ${section.heading}`}
                      value={variant.text}
                      onChange={(e) => editBullet(variant.id, e.target.value)}
                    />
                    <div className="review-bullet-foot">
                      {faults.map((fault) => (
                        <span key={fault.kind} className="pill pill-warning" title={fault.detail}>
                          {fault.kind.replace(/-/g, ' ')}
                        </span>
                      ))}
                      <button
                        type="button"
                        className="btn-plain"
                        disabled={kept.has(variant.id)}
                        onClick={() => void keepInBank(variant)}
                      >
                        {kept.has(variant.id) ? 'Kept for next time' : 'Keep this wording'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {document.education.length > 0 && (
          <div className="review-section">
            <p className="review-heading">Education</p>
            {document.education.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}

        {document.skills.length > 0 && (
          <div className="review-section">
            <p className="review-heading">Skills</p>
            {document.skills.map((group, index) => (
              <p key={group.label ?? index}>
                {group.label && <strong>{group.label}: </strong>}
                {group.items.join(', ')}
              </p>
            ))}
          </div>
        )}

        {document.omitted.length > 0 && (
          <p className="hint mt-2">
            Left off to keep this to a page: {document.omitted.join(', ')}.
          </p>
        )}
      </section>

      {letterDocument && (
        <section>
          <h2>Cover letter</h2>
          <div className="status-row">
            <span className="pill pill-neutral">
              {letterDocument.language === 'de' ? 'German' : 'English'}
            </span>
            {letterFaults.map((fault) => (
              <span key={fault.kind} className="pill pill-warning" title={fault.detail}>
                {fault.kind.replace(/-/g, ' ')}
              </span>
            ))}
          </div>

          {/* Shown, not editable: this is assembled from the application rather
              than written, which is why it can no longer come out missing. */}
          <div className="review-letter-head">
            <p className="hint">{letterDocument.recipientLines.join(' · ')}</p>
            <p className="hint">{letterDocument.date}</p>
            <p>
              <strong>{letterDocument.subject}</strong>
            </p>
            <p>{letterDocument.salutation}</p>
          </div>

          <textarea
            className="review-letter"
            aria-label="Cover letter body"
            value={letter}
            onChange={(e) => setLetter(e.target.value)}
          />

          <div className="review-letter-head">
            <p>{letterDocument.closing}</p>
            <p>{letterDocument.signature}</p>
          </div>
        </section>
      )}

      {error && <p className="error">{error}</p>}
      {saved && <p className="status-row"><span className="pill pill-success">Saved {saved.join(', ')}</span></p>}

      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={save}>
          Save to documents folder
        </button>
      </div>
    </main>
  );
}
