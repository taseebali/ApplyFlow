import { useEffect, useState } from 'react';
import { atsFromUrl } from '@/lib/company-scraper';
import { getTabState, patchTabState } from '@/lib/tab-state';
import type { GetJobInfoMessage, GetJobInfoResponse } from '@/entrypoints/content';
import { getActiveTabId } from './DailyView';

/**
 * Which posting the panel is working on, pinned above everything else.
 *
 * The panel never stated this. That is also how a tailored resume saved itself
 * as `Jordan_Avery_Resume (2).docx`: nothing on screen had ever named the
 * company, so nothing caught that it was missing.
 *
 * What the user types here is stored against the tab and is the single source
 * of the company and role for everything downstream — the filename, the
 * letter's salutation, the Notion entry. Detection is a starting point, not an
 * authority.
 */

export interface Posting {
  company: string;
  role: string;
  ats: string | null;
  url: string;
  /** False when detection found nothing, so the panel can say so plainly. */
  detected: boolean;
}

export const EMPTY_POSTING: Posting = { company: '', role: '', ats: null, url: '', detected: false };

/** Reads the posting for a tab: what was detected, with the user's edits on top. */
export async function readPosting(tabId: number): Promise<Posting> {
  let detected: GetJobInfoResponse | null = null;
  try {
    detected = await browser.tabs.sendMessage(tabId, { type: 'get-job-info' } satisfies GetJobInfoMessage);
  } catch {
    // No content script on this page — a new tab, a PDF, the store. Not an error.
  }

  const override = (await getTabState(tabId)).posting;
  const url = detected?.jobUrl ?? '';

  return {
    // `??` rather than `||`: an empty string here is the user clearing a wrong
    // detection, and must not fall back to the wrong value again.
    company: override?.company ?? detected?.companyName ?? '',
    role: override?.role ?? detected?.jobTitle ?? '',
    ats: url ? atsFromUrl(url) : null,
    url,
    detected: Boolean(detected?.companyName || detected?.jobTitle),
  };
}

export function usePosting(tabId: number | null): [Posting, (patch: Partial<Posting>) => void] {
  const [posting, setPosting] = useState<Posting>(EMPTY_POSTING);

  useEffect(() => {
    if (tabId === null) return;
    void readPosting(tabId).then(setPosting);
  }, [tabId]);

  const update = (patch: Partial<Posting>) => {
    setPosting((current) => {
      const next = { ...current, ...patch };
      if (tabId !== null) {
        void patchTabState(tabId, { posting: { company: next.company, role: next.role } });
      }
      return next;
    });
  };

  return [posting, update];
}

export function JobContextBar({
  posting,
  onChange,
}: {
  posting: Posting;
  onChange: (patch: Partial<Posting>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const known = posting.company || posting.role;

  if (editing) {
    return (
      <div className="job-bar job-bar-editing">
        <label className="field">
          <span>Company</span>
          <input
            type="text"
            autoFocus
            value={posting.company}
            placeholder="Enpal"
            onChange={(e) => onChange({ company: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Role</span>
          <input
            type="text"
            value={posting.role}
            placeholder="AI Engineer"
            onChange={(e) => onChange({ role: e.target.value })}
          />
        </label>
        <button type="button" className="btn" onClick={() => setEditing(false)}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="job-bar">
      <span className={`job-avatar ${known ? '' : 'job-avatar-unknown'}`} aria-hidden="true">
        {posting.company.trim().charAt(0).toUpperCase() || '?'}
      </span>
      <span className="job-identity">
        <span className="job-name">{posting.company || (known ? posting.role : 'No job posting here')}</span>
        <span className="job-sub">
          {known
            ? [posting.company ? posting.role : '', posting.ats].filter(Boolean).join(' · ') ||
              hostOf(posting.url)
            : hostOf(posting.url) || 'Open a job application to start'}
        </span>
      </span>
      <button type="button" className="btn-plain job-edit" onClick={() => setEditing(true)}>
        {known ? 'Edit' : 'Add'}
      </button>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
