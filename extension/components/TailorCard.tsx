import { useState } from 'react';
import { ActionCard } from '@/components/ActionCard';
import { DraftIcon } from '@/components/icons';
import { tailorResume, type TailorResult } from '@/lib/tailor-run';
import { resumeFilename, toDocxBlob } from '@/lib/resume-document';
import { ensureReadPermission, getDocumentsFolderHandle, saveToDocumentsFolder } from '@/lib/document-store';
import type { GetJobInfoMessage, GetJobInfoResponse } from '@/entrypoints/content';
import { getActiveTabId } from './DailyView';

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'ready'; result: TailorResult; company: string }
  | { kind: 'saved'; filename: string }
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

      const result = await tailorResume({ jobDescription: info.jobDescription ?? '' });
      setStatus({ kind: 'ready', result, company: info.companyName ?? '' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not build a resume.' });
    }
  };

  const save = async () => {
    if (status.kind !== 'ready') return;
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

      const blob = await toDocxBlob(status.result.document);
      const filename = await saveToDocumentsFolder(
        handle,
        resumeFilename(status.result.document, status.company),
        blob
      );
      // Now in the documents folder, so Attach documents finds it like any other.
      setStatus({ kind: 'saved', filename });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not save the file.' });
    }
  };

  const result = status.kind === 'ready' ? status.result : null;

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
        {status.kind === 'saved' && <span className="pill pill-success">Saved {status.filename}</span>}
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

      {!closed && result && (
        <div className="tailor-preview">
          {result.gap.missing.length > 0 && (
            <div className="notice notice-warning">
              <p>
                This posting asks for <strong>{result.gap.missing.map((g) => g.term).join(', ')}</strong> and nothing
                in your profile mentions {result.gap.missing.length === 1 ? 'it' : 'them'}. Tailoring can reorder what
                you have; it cannot cover a gap.
              </p>
            </div>
          )}

          {result.document.experience.concat(result.document.projects).map((section) => (
            <div className="tailor-section" key={section.heading}>
              <p className="tailor-heading">
                {section.heading}
                {section.meta && <span className="hint"> · {section.meta}</span>}
              </p>
              <ul>
                {section.bullets.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          ))}

          <button type="button" className="btn btn-primary" onClick={save}>
            Save to documents folder
          </button>
        </div>
      )}
    </>
  );
}
