import { useState } from 'react';
import type {
  AttachDocumentsMessage,
  AttachDocumentsResponse,
  FillPageMessage,
  FillPageResponse,
  GetJobInfoMessage,
  GetJobInfoResponse,
  GetQuestionsMessage,
  GetQuestionsResponse,
  InsertAnswerMessage,
  InsertAnswerResponse,
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
import { draftAnswer } from '@/lib/llm-client';
import { getProfile, setProfile } from '@/lib/storage';
import { ActionCard } from '@/components/ActionCard';
import { AttachIcon, DraftIcon, FillIcon, TrackerIcon } from '@/components/icons';

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

type DraftState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not-configured' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; drafts: Array<{ id: string; question: string; text: string; inserted: boolean }> };

function DraftAnswersCard() {
  const [state, setState] = useState<DraftState>({ kind: 'idle' });

  const handleDraft = async () => {
    setState({ kind: 'loading' });
    try {
      const settings = await getSettings();
      if (!settings.llm.backend) {
        setState({ kind: 'not-configured' });
        return;
      }

      const tabId = await getActiveTabId();
      const message: GetQuestionsMessage = { type: 'get-questions' };
      const found: GetQuestionsResponse = await browser.tabs.sendMessage(tabId, message);

      if (found.questions.length === 0) {
        setState({ kind: 'error', message: 'No open-ended questions found on this page.' });
        return;
      }

      const profile = await getProfile();
      const drafts = [];
      for (const q of found.questions) {
        // A saved answer wins over a fresh generation: it is instant, free,
        // and already worded the way the user wants.
        const saved = profile.customQA.find((entry) =>
          entry.question.toLowerCase().includes(q.question.toLowerCase().slice(0, 25))
        );
        const text = saved
          ? saved.answer
          : await draftAnswer(
              { question: q.question, jobDescription: found.jobDescription, profile },
              settings.llm
            );
        drafts.push({ id: q.id, question: q.question, text, inserted: false });
      }
      setState({ kind: 'ready', drafts });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not draft answers.',
      });
    }
  };

  const updateDraft = (id: string, patch: Partial<{ text: string; inserted: boolean }>) =>
    setState((prev) =>
      prev.kind === 'ready'
        ? { kind: 'ready', drafts: prev.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)) }
        : prev
    );

  const handleInsert = async (id: string, text: string) => {
    const tabId = await getActiveTabId();
    const message: InsertAnswerMessage = { type: 'insert-answer', id, text };
    const response: InsertAnswerResponse = await browser.tabs.sendMessage(tabId, message);
    if (response.inserted) updateDraft(id, { inserted: true });
  };

  const handleSaveReusable = async (question: string, answer: string) => {
    const profile = await getProfile();
    await setProfile({
      ...profile,
      customQA: [...profile.customQA, { id: crypto.randomUUID(), question, answer }],
    });
  };

  return (
    <>
      <ActionCard
        icon={<DraftIcon />}
        title="Draft answers"
        description="Drafts replies to open-ended questions. You review before anything is entered."
        tint="neutral"
        onClick={handleDraft}
        disabled={state.kind === 'loading'}
      >
        {state.kind === 'loading' && <span className="pill pill-neutral">Drafting…</span>}
        {state.kind === 'not-configured' && (
          <span className="pill pill-neutral">Set up AI drafting in Settings first</span>
        )}
        {state.kind === 'error' && <span className="pill pill-danger">{state.message}</span>}
      </ActionCard>

      {state.kind === 'ready' && (
        <div className="drafts">
          {state.drafts.map((draft) => (
            <div className="draft" key={draft.id}>
              <p className="draft-question">{draft.question}</p>
              <textarea value={draft.text} onChange={(e) => updateDraft(draft.id, { text: e.target.value })} />
              <div className="draft-actions">
                <button className="btn btn-primary" onClick={() => handleInsert(draft.id, draft.text)}>
                  {draft.inserted ? 'Inserted' : 'Insert'}
                </button>
                <button className="btn" onClick={() => handleSaveReusable(draft.question, draft.text)}>
                  Save for reuse
                </button>
              </div>
            </div>
          ))}
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
      <DraftAnswersCard />
    </div>
  );
}
