import { useState } from 'react';
import type {
  AttachDocumentsMessage,
  AttachDocumentsResponse,
  FillPageMessage,
  FillPageResponse,
  GetJobInfoMessage,
  GetJobInfoResponse,
} from '@/entrypoints/content';
import { ensureReadPermission, getDocumentsFolderHandle } from '@/lib/document-store';
import {
  findBestMatch,
  listFolderFiles,
  type DocumentKind,
  type DocumentMatchResult,
  type FolderFile,
} from '@/lib/document-matcher';
import { getSettings } from '@/lib/settings';
import { logApplicationToNotion } from '@/lib/notion-client';
import { ActionCard } from '@/components/ActionCard';
import { AttachIcon, FillIcon, TrackerIcon } from '@/components/icons';

type FillStatus =
  | { kind: 'idle' }
  | { kind: 'filling' }
  | { kind: 'done'; filledCount: number; unmatchedCount: number; unmatchedLabels: string[] }
  | { kind: 'error'; message: string };

type DocStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'no-folder' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; resume: DocumentMatchResult; coverLetter: DocumentMatchResult };

type AttachState = 'pending' | 'attached' | 'failed';

const DOC_LABELS: Record<DocumentKind, string> = { resume: 'Resume', coverLetter: 'Cover letter' };

export async function getActiveTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found. Open a job application page first.');
  return tab.id;
}

function FillAndAttachSection() {
  const [fillStatus, setFillStatus] = useState<FillStatus>({ kind: 'idle' });
  const [docStatus, setDocStatus] = useState<DocStatus>({ kind: 'idle' });
  const [attachState, setAttachState] = useState<Partial<Record<DocumentKind, AttachState>>>({});

  const handleFillClick = async () => {
    setFillStatus({ kind: 'filling' });
    try {
      const tabId = await getActiveTabId();
      const message: FillPageMessage = { type: 'fill-page' };
      const response: FillPageResponse = await browser.tabs.sendMessage(tabId, message);
      setFillStatus({
        kind: 'done',
        filledCount: response.filledCount,
        unmatchedCount: response.unmatchedCount,
        unmatchedLabels: response.unmatchedLabels,
      });
    } catch (err) {
      setFillStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not fill this page.' });
    }
  };

  const attachDocuments = async (entries: Array<{ kind: DocumentKind; folderFile: FolderFile }>, tabId: number) => {
    setAttachState((prev) => {
      const next = { ...prev };
      for (const e of entries) next[e.kind] = 'pending';
      return next;
    });
    try {
      const files = await Promise.all(
        entries.map(async (e) => {
          const file = await e.folderFile.handle.getFile();
          const data = await file.arrayBuffer();
          return { kind: e.kind, name: file.name, mimeType: file.type, data };
        })
      );
      const message: AttachDocumentsMessage = { type: 'attach-documents', files };
      const response: AttachDocumentsResponse = await browser.tabs.sendMessage(tabId, message);
      setAttachState((prev) => {
        const next = { ...prev };
        for (const e of entries) next[e.kind] = response.attached[e.kind] ? 'attached' : 'failed';
        return next;
      });
    } catch {
      setAttachState((prev) => {
        const next = { ...prev };
        for (const e of entries) next[e.kind] = 'failed';
        return next;
      });
    }
  };

  const handleCheckDocuments = async () => {
    setDocStatus({ kind: 'loading' });
    setAttachState({});
    try {
      const handle = await getDocumentsFolderHandle();
      if (!handle) {
        setDocStatus({ kind: 'no-folder' });
        return;
      }
      if (!(await ensureReadPermission(handle))) {
        setDocStatus({ kind: 'error', message: 'Folder access was not granted.' });
        return;
      }

      const tabId = await getActiveTabId();
      const jobInfoMessage: GetJobInfoMessage = { type: 'get-job-info' };
      const jobInfo: GetJobInfoResponse = await browser.tabs.sendMessage(tabId, jobInfoMessage);

      const files = await listFolderFiles(handle);
      const resume = findBestMatch(files, 'resume', jobInfo.companyName);
      const coverLetter = findBestMatch(files, 'coverLetter', jobInfo.companyName);
      setDocStatus({ kind: 'ready', resume, coverLetter });

      const autoAttachEntries = (
        [
          ['resume', resume],
          ['coverLetter', coverLetter],
        ] as const
      )
        .filter(([, result]) => result.matchedBy === 'company' && result.file)
        .map(([kind, result]) => ({ kind, folderFile: result.file! }));

      if (autoAttachEntries.length > 0) {
        await attachDocuments(autoAttachEntries, tabId);
      }
    } catch (err) {
      setDocStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not check documents.' });
    }
  };

  const handleConfirmAttach = async (kind: DocumentKind, folderFile: FolderFile) => {
    const tabId = await getActiveTabId();
    await attachDocuments([{ kind, folderFile }], tabId);
  };

  return (
    <>
      <ActionCard
        icon={<FillIcon />}
        title="Fill this page"
        description="Fills the form from your saved profile."
        tint="blue"
        onClick={handleFillClick}
        disabled={fillStatus.kind === 'filling'}
      >
        {fillStatus.kind === 'filling' && <span className="pill pill-neutral">Filling…</span>}
        {fillStatus.kind === 'done' && (
          <>
            <span className={`pill ${fillStatus.unmatchedCount > 0 ? 'pill-warning' : 'pill-success'}`}>
              {fillStatus.filledCount} filled
            </span>
            {fillStatus.unmatchedCount > 0 && (
              <span className="pill pill-neutral">{fillStatus.unmatchedCount} need attention</span>
            )}
            {fillStatus.unmatchedLabels.length > 0 && (
              <span className="unmatched-labels" title="Recognized but has no data in your profile yet">
                {fillStatus.unmatchedLabels.join(' · ')}
              </span>
            )}
          </>
        )}
        {fillStatus.kind === 'error' && <span className="pill pill-danger">{fillStatus.message}</span>}
      </ActionCard>

      <ActionCard
        icon={<AttachIcon />}
        title="Attach documents"
        description="Finds and attaches your resume and cover letter."
        tint="green"
        onClick={handleCheckDocuments}
        disabled={docStatus.kind === 'loading'}
      >
        {docStatus.kind === 'no-folder' && (
          <span className="pill pill-neutral">No documents folder linked — see Documents below</span>
        )}
        {docStatus.kind === 'error' && <span className="pill pill-danger">{docStatus.message}</span>}
      </ActionCard>
      {docStatus.kind === 'ready' && (
        <div className="doc-results">
          {(['resume', 'coverLetter'] as const).map((kind) => {
            const result = kind === 'resume' ? docStatus.resume : docStatus.coverLetter;
            const state = attachState[kind];
            const label = DOC_LABELS[kind];

            if (!result.file) {
              return (
                <div key={kind} className="doc-row">
                  <span className="doc-row-label">{label}</span>
                  <span className="pill pill-neutral">no match found</span>
                </div>
              );
            }
            if (state === 'attached') {
              return (
                <div key={kind} className="doc-row">
                  <span className="doc-row-label" title={result.file.name}>
                    {label} — {result.file.name}
                  </span>
                  <span className="pill pill-success">attached</span>
                </div>
              );
            }
            if (result.matchedBy === 'company') {
              return (
                <div key={kind} className="doc-row">
                  <span className="doc-row-label" title={result.file.name}>
                    {label} — {result.file.name}
                  </span>
                  <span className={`pill ${state === 'failed' ? 'pill-danger' : 'pill-neutral'}`}>
                    {state === 'failed' ? 'failed' : 'attaching…'}
                  </span>
                </div>
              );
            }
            return (
              <div key={kind} className="doc-row">
                <span className="doc-row-label" title={result.file.name}>
                  {label} — {result.file.name} <span className="pill pill-warning">best guess</span>
                </span>
                <button className="btn" onClick={() => handleConfirmAttach(kind, result.file!)} disabled={state === 'pending'}>
                  {state === 'pending' ? 'Attaching…' : state === 'failed' ? 'Retry' : 'Attach'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

interface LogForm {
  title: string;
  company: string;
  jobUrl: string;
  source: string;
  jobDescription: string;
}

type NotionStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'no-settings' }
  | { kind: 'form'; form: LogForm }
  | { kind: 'logging' }
  | { kind: 'done'; url: string }
  | { kind: 'error'; message: string };

function inferSource(jobUrl: string): string {
  try {
    const host = new URL(jobUrl).hostname;
    if (host.includes('linkedin')) return 'LinkedIn';
    if (host.includes('indeed') || host.includes('glassdoor') || host.includes('stepstone')) return 'Job board';
  } catch {
    // Not a valid URL — fall through to the default.
  }
  return 'Company site';
}

function LogToNotionSection() {
  const [status, setStatus] = useState<NotionStatus>({ kind: 'idle' });

  const handleStart = async () => {
    setStatus({ kind: 'loading' });
    try {
      const settings = await getSettings();
      if (!settings.notion.token || !settings.notion.databaseId) {
        setStatus({ kind: 'no-settings' });
        return;
      }

      const tabId = await getActiveTabId();
      const message: GetJobInfoMessage = { type: 'get-job-info' };
      const jobInfo: GetJobInfoResponse = await browser.tabs.sendMessage(tabId, message);

      setStatus({
        kind: 'form',
        form: {
          title: jobInfo.jobTitle ?? '',
          company: jobInfo.companyName ?? '',
          jobUrl: jobInfo.jobUrl,
          source: inferSource(jobInfo.jobUrl),
          jobDescription: jobInfo.jobDescription ?? '',
        },
      });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not read this page.' });
    }
  };

  const updateForm = (patch: Partial<LogForm>) => {
    if (status.kind !== 'form') return;
    setStatus({ kind: 'form', form: { ...status.form, ...patch } });
  };

  const handleConfirm = async () => {
    if (status.kind !== 'form') return;
    const { form } = status;
    setStatus({ kind: 'logging' });
    try {
      const settings = await getSettings();
      const { url } = await logApplicationToNotion(settings.notion, {
        title: form.title,
        company: form.company,
        jobUrl: form.jobUrl,
        source: form.source,
        jobDescription: form.jobDescription || null,
      });
      setStatus({ kind: 'done', url });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not log to Notion.' });
    }
  };

  return (
    <>
      <ActionCard
        icon={<TrackerIcon />}
        title="Log to Notion"
        description="Saves this application to your Notion tracker."
        tint="amber"
        onClick={handleStart}
        disabled={status.kind === 'loading' || status.kind === 'form'}
      >
        {status.kind === 'no-settings' && (
          <span className="pill pill-neutral">Add your Notion integration token below first</span>
        )}
        {status.kind === 'error' && <span className="pill pill-danger">{status.message}</span>}
        {status.kind === 'done' && <span className="pill pill-success">Logged to Notion</span>}
      </ActionCard>
      {status.kind === 'done' && (
        <a href={status.url} target="_blank" rel="noreferrer" className="btn-plain">
          Open row
        </a>
      )}
      {status.kind === 'form' && (
        <div className="log-form">
          <label className="field">
            <span>Title</span>
            <input type="text" value={status.form.title} onChange={(e) => updateForm({ title: e.target.value })} />
          </label>
          <label className="field">
            <span>Company</span>
            <input
              type="text"
              value={status.form.company}
              onChange={(e) => updateForm({ company: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Source</span>
            <input type="text" value={status.form.source} onChange={(e) => updateForm({ source: e.target.value })} />
          </label>
          <label className="field">
            <span>
              Job description{' '}
              {!status.form.jobDescription && <span className="pill pill-warning">couldn't auto-detect — paste it</span>}
            </span>
            <textarea
              value={status.form.jobDescription}
              onChange={(e) => updateForm({ jobDescription: e.target.value })}
              rows={5}
            />
          </label>
          <div className="log-form-actions">
            <button className="btn" onClick={() => setStatus({ kind: 'idle' })}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleConfirm}>
              Confirm &amp; log to Notion
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function DailyView({ onOpenSetup }: { onOpenSetup: () => void }) {
  void onOpenSetup;
  return (
    <div className="daily-actions">
      <FillAndAttachSection />
      <LogToNotionSection />
    </div>
  );
}
