import { useEffect, useState } from 'react';
import { takeReview, type ReviewHandoff } from '@/lib/review-handoff';
import { getBank, reviseVariant, setBank, type BulletVariant } from '@/lib/bullet-bank';
import { scoreBullet, scoreSection } from '@/lib/bullet-quality';
import { coverLetterFaults } from '@/lib/cover-letter';
import {
  coverLetterFilename,
  coverLetterToDocxBlob,
  resumeFilename,
  toDocxBlob,
} from '@/lib/resume-document';
import { assembleResume } from '@/lib/resume-document';
import { getProfile } from '@/lib/storage';
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bullets, setBullets] = useState<BulletVariant[]>([]);
  const [letter, setLetter] = useState('');
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void takeReview().then((data) => {
      setHandoff(data);
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

  const document = assembleResume(profile, bullets);
  const score = scoreSection(bullets.map((b) => b.text)).score;
  const letterFaults = coverLetterFaults(letter, bullets.map((b) => b.text));

  const save = async () => {
    setError(null);
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
        await saveToDocumentsFolder(handle, resumeFilename(document, handoff.company), await toDocxBlob(document))
      );
      if (letter.trim()) {
        names.push(
          await saveToDocumentsFolder(
            handle,
            coverLetterFilename(document, handoff.company),
            await coverLetterToDocxBlob({
              name: document.name,
              contactLine: document.contactLine,
              body: letter,
            })
          )
        );
      }
      setSaved(names);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  };

  const sections = document.experience.concat(document.projects);

  return (
    <main className="review">
      <header className="review-head">
        <div>
          <p className="eyebrow">Review before sending</p>
          <h1>{[handoff.role, handoff.company].filter(Boolean).join(' · ') || 'Tailored application'}</h1>
        </div>
        <span className={`pill ${score >= 80 ? 'pill-success' : score >= 55 ? 'pill-warning' : 'pill-danger'}`}>
          {score}/100
        </span>
      </header>

      {handoff.result.gap.missing.length > 0 && (
        <div className="notice notice-warning">
          <p>
            This posting asks for <strong>{handoff.result.gap.missing.map((g) => g.term).join(', ')}</strong> and
            nothing in your profile mentions {handoff.result.gap.missing.length === 1 ? 'it' : 'them'}.
          </p>
        </div>
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
              </p>
              {owned.map((variant) => {
                const faults = scoreBullet(variant.text);
                return (
                  <div className="review-bullet" key={variant.id}>
                    <textarea
                      rows={2}
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
      </section>

      {letter && (
        <section>
          <h2>Cover letter</h2>
          <div className="status-row">
            {letterFaults.map((fault) => (
              <span key={fault.kind} className="pill pill-warning" title={fault.detail}>
                {fault.kind.replace(/-/g, ' ')}
              </span>
            ))}
          </div>
          <textarea className="review-letter" value={letter} onChange={(e) => setLetter(e.target.value)} />
        </section>
      )}

      {error && <p className="error">{error}</p>}
      {saved && <p className="status-row"><span className="pill pill-success">Saved {saved.join(', ')}</span></p>}

      <div className="review-actions">
        <button type="button" className="btn btn-primary" onClick={save}>
          Save to documents folder
        </button>
      </div>
    </main>
  );
}
