import { useEffect, useState } from 'react';
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
import { normalizeQuestion } from '@/lib/question-matching';
import { findExistingApplications, logApplicationToNotion, type ExistingApplication } from '@/lib/notion-client';
import { setFieldOverride } from '@/lib/field-overrides';
import { SCHEMA_FIELDS } from '@/lib/schema';
import type { UnrecognizedField } from '@/lib/field-matcher';
import { draftAnswer } from '@/lib/llm-client';
import { getProfile, setProfile } from '@/lib/storage';
import { ActionCard } from '@/components/ActionCard';
import { AttachIcon, DraftIcon, FillIcon, TrackerIcon } from '@/components/icons';

type FillStatus =
  | { kind: 'idle' }
  | { kind: 'filling' }
  | {
      kind: 'done';
      filledCount: number;
      unmatchedCount: number;
      unmatchedLabels: string[];
      unrecognized: UnrecognizedField[];
      hostname: string;
    }
  | { kind: 'page-changed' }
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

function FillAndAttachSection({ onOpenSetup }: { onOpenSetup: () => void }) {
  const [fillStatus, setFillStatus] = useState<FillStatus>({ kind: 'idle' });
  const [docStatus, setDocStatus] = useState<DocStatus>({ kind: 'idle' });
  const [attachState, setAttachState] = useState<Partial<Record<DocumentKind, AttachState>>>({});
  const [attachError, setAttachError] = useState<string | null>(null);

  // A multi-page application swaps the form underneath us. Clear the old
  // summary so it cannot be mistaken for the current page being done.
  useEffect(() => {
    const onMessage = (message: { type?: string }) => {
      if (message?.type !== 'page-changed') return;
      setFillStatus((prev) => (prev.kind === 'done' ? { kind: 'page-changed' } : prev));
      setDocStatus({ kind: 'idle' });
      setAttachState({});
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

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
        unrecognized: response.unrecognized,
        hostname: response.hostname,
      });
    } catch (err) {
      setFillStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not fill this page.' });
    }
  };

  const attachDocuments = async (entries: Array<{ kind: DocumentKind; folderFile: FolderFile }>, tabId: number) => {
    setAttachError(null);
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
      // `sendMessage` rejects outright when no content script is listening — a
      // chrome:// page, a PDF viewer, or a tab that was already open when the
      // extension was installed. Say so instead of leaving a dead button.
      setAttachError('Could not reach this page. Reload the job application tab, then try again.');
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
    setAttachError(null);
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
    setAttachState((prev) => ({ ...prev, [kind]: 'pending' }));
    setAttachError(null);
    try {
      const tabId = await getActiveTabId();
      await attachDocuments([{ kind, folderFile }], tabId);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Could not attach that document.');
      setAttachState((prev) => ({ ...prev, [kind]: 'failed' }));
    }
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
        {fillStatus.kind === 'page-changed' && (
          <span className="pill pill-warning">This page changed — fill it too</span>
        )}
        {fillStatus.kind === 'error' && <span className="pill pill-danger">{fillStatus.message}</span>}
      </ActionCard>

      {fillStatus.kind === 'done' && fillStatus.unrecognized.length > 0 && (
        <TeachFieldsPanel
          fields={fillStatus.unrecognized}
          hostname={fillStatus.hostname}
          onTaught={handleFillClick}
        />
      )}

      <ActionCard
        icon={<AttachIcon />}
        title="Attach documents"
        description="Finds and attaches your resume and cover letter."
        tint="green"
        onClick={handleCheckDocuments}
        disabled={docStatus.kind === 'loading'}
      >
        {docStatus.kind === 'loading' && <span className="pill pill-neutral">Checking…</span>}
        {docStatus.kind === 'no-folder' && (
          <span className="pill pill-neutral">No documents folder linked — set it up in Settings</span>
        )}
        {docStatus.kind === 'error' && <span className="pill pill-danger">{docStatus.message}</span>}
      </ActionCard>
      {docStatus.kind === 'no-folder' && (
        <button type="button" className="btn-plain" onClick={onOpenSetup}>
          Open Settings
        </button>
      )}
      {attachError && <span className="pill pill-danger">{attachError}</span>}
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
  | { kind: 'form'; form: LogForm; duplicates?: ExistingApplication[] }
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

/**
 * Lets the user say what a field actually was, once, and remembers it for
 * this site. Fill accuracy then improves with use instead of staying flat.
 */
function TeachFieldsPanel({
  fields,
  hostname,
  onTaught,
}: {
  fields: UnrecognizedField[];
  hostname: string;
  onTaught: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const teach = async (signature: string, path: string) => {
    if (!path) return;
    setSaving(signature);
    try {
      await setFieldOverride(hostname, signature, path);
      // Re-fill straight away so the effect is visible rather than promised.
      onTaught();
    } finally {
      setSaving(null);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn-plain teach-toggle" onClick={() => setOpen(true)}>
        {fields.length} field{fields.length === 1 ? '' : 's'} not recognised — tell ApplyFlow what they are
      </button>
    );
  }

  return (
    <div className="teach-panel">
      <p className="teach-intro">
        Pick what each field is. ApplyFlow remembers it for <strong>{hostname}</strong> only.
      </p>
      {fields.map((field) => (
        <div className="teach-row" key={field.signature}>
          <span className="teach-label" title={field.signature}>
            {field.label}
          </span>
          <select
            defaultValue=""
            disabled={saving === field.signature}
            onChange={(e) => teach(field.signature, e.target.value)}
          >
            <option value="">Skip</option>
            {SCHEMA_FIELDS.map((f) => (
              <option key={f.path} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button type="button" className="btn-plain" onClick={() => setOpen(false)}>
        Done
      </button>
    </div>
  );
}

function LogToNotionSection({ onOpenSetup }: { onOpenSetup: () => void }) {
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

      const form: LogForm = {
        title: jobInfo.jobTitle ?? '',
        company: jobInfo.companyName ?? '',
        jobUrl: jobInfo.jobUrl,
        source: inferSource(jobInfo.jobUrl),
        jobDescription: jobInfo.jobDescription ?? '',
      };
      setStatus({ kind: 'form', form });

      // Checked after the form is already up: a duplicate warning is a
      // convenience, so it must never delay or block logging.
      const duplicates = await findExistingApplications(settings.notion, form.company);
      if (duplicates.length) {
        setStatus((prev) => (prev.kind === 'form' ? { ...prev, duplicates } : prev));
      }
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
        disabled={status.kind === 'loading' || status.kind === 'form' || status.kind === 'logging'}
      >
        {status.kind === 'loading' && <span className="pill pill-neutral">Reading page…</span>}
        {status.kind === 'logging' && <span className="pill pill-neutral">Logging…</span>}
        {status.kind === 'no-settings' && (
          <span className="pill pill-neutral">Add your Notion integration token in Settings first</span>
        )}
        {status.kind === 'error' && <span className="pill pill-danger">{status.message}</span>}
        {status.kind === 'done' && <span className="pill pill-success">Logged to Notion</span>}
      </ActionCard>
      {status.kind === 'no-settings' && (
        <button type="button" className="btn-plain" onClick={onOpenSetup}>
          Open Settings
        </button>
      )}
      {status.kind === 'done' && (
        <a href={status.url} target="_blank" rel="noreferrer" className="btn-plain">
          Open row
        </a>
      )}
      {status.kind === 'form' && (
        <div className="log-form">
          {status.duplicates?.length ? (
            <div className="duplicate-warning">
              <span className="pill pill-warning">
                Already logged {status.duplicates.length === 1 ? 'once' : `${status.duplicates.length} times`} for
                this company
              </span>
              {status.duplicates.map((d) => (
                <a key={d.url} href={d.url} target="_blank" rel="noreferrer" className="duplicate-row">
                  {d.title}
                  {d.appliedDate ? ` — ${d.appliedDate}` : ''}
                  {d.status ? ` (${d.status})` : ''}
                </a>
              ))}
            </div>
          ) : null}
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

interface Draft {
  id: string;
  question: string;
  text: string;
  inserted: boolean;
  saved: boolean;
  /** Set when this specific question failed to *draft*; text is empty, so the textarea is hidden while set. */
  error?: string;
  /** Set when an *insert* into the page fails after a successful draft. Renders alongside the textarea — the user's edited text must never be discarded. */
  insertError?: string;
  saveState?: 'saving' | 'saved' | 'error';
  saveError?: string;
}

type DraftState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not-configured' }
  | { kind: 'no-questions' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; drafts: Draft[] };

// Serializes profile read-modify-write across concurrent "Save for reuse"
// clicks so a second save can't clobber the first (both would otherwise read
// the same stale profile and the second write would drop the first's entry).
let saveQueue: Promise<void> = Promise.resolve();

function queueProfileSave(question: string, answer: string): Promise<void> {
  const next = saveQueue.then(async () => {
    const profile = await getProfile();
    await setProfile({
      ...profile,
      customQA: [...profile.customQA, { id: crypto.randomUUID(), question, answer }],
    });
  });
  // Keep the chain alive even if this save fails, so later saves still run.
  saveQueue = next.catch(() => undefined);
  return next;
}

function DraftAnswersCard({ onOpenSetup }: { onOpenSetup: () => void }) {
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
        setState({ kind: 'no-questions' });
        return;
      }

      const profile = await getProfile();
      const drafts: Draft[] = [];
      for (const q of found.questions) {
        // A saved answer wins over a fresh generation: it is instant, free,
        // and already worded the way the user wants. Require the normalized
        // question to match exactly — a loose prefix/substring match can
        // silently reuse the wrong saved answer for a similarly-worded
        // question, putting wrong text into a real application.
        const saved = profile.customQA.find(
          (entry) => normalizeQuestion(entry.question) === normalizeQuestion(q.question)
        );
        if (saved) {
          drafts.push({ id: q.id, question: q.question, text: saved.answer, inserted: false, saved: true });
          continue;
        }
        // A failure on one question must not discard drafts already
        // generated for other questions, and must not force re-billing
        // every question on a retry.
        try {
          const text = await draftAnswer(
            { question: q.question, jobDescription: found.jobDescription, profile },
            settings.llm
          );
          drafts.push({ id: q.id, question: q.question, text, inserted: false, saved: false });
        } catch (err) {
          drafts.push({
            id: q.id,
            question: q.question,
            text: '',
            inserted: false,
            saved: false,
            error: err instanceof Error ? err.message : 'Could not draft this answer.',
          });
        }
      }
      setState({ kind: 'ready', drafts });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not draft answers.',
      });
    }
  };

  const updateDraft = (id: string, patch: Partial<Draft>) =>
    setState((prev) =>
      prev.kind === 'ready'
        ? { kind: 'ready', drafts: prev.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)) }
        : prev
    );

  const handleInsert = async (id: string, text: string) => {
    updateDraft(id, { insertError: undefined });
    try {
      const tabId = await getActiveTabId();
      const message: InsertAnswerMessage = { type: 'insert-answer', id, text };
      const response: InsertAnswerResponse = await browser.tabs.sendMessage(tabId, message);
      if (response.inserted) {
        updateDraft(id, { inserted: true });
      } else {
        // The content script's element map is empty for this id — most likely
        // it was re-injected by a page navigation since the draft was made.
        updateDraft(id, {
          insertError: "Couldn't find that field on the page any more — press Draft answers again.",
        });
      }
    } catch (err) {
      // `sendMessage` rejects outright when no content script is listening —
      // a chrome:// page, a PDF viewer, or a tab open before install. The
      // user's edited text must stay on screen either way.
      updateDraft(id, {
        insertError:
          err instanceof Error ? err.message : 'Could not reach this page. Reload the tab, then try again.',
      });
    }
  };

  const handleSaveReusable = async (id: string, question: string, answer: string) => {
    updateDraft(id, { saveState: 'saving', saveError: undefined });
    try {
      await queueProfileSave(question, answer);
      updateDraft(id, { saveState: 'saved' });
    } catch (err) {
      updateDraft(id, {
        saveState: 'error',
        saveError: err instanceof Error ? err.message : 'Could not save this answer.',
      });
    }
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
        {state.kind === 'no-questions' && (
          <span className="pill pill-neutral">No open-ended questions found on this page.</span>
        )}
        {state.kind === 'error' && <span className="pill pill-danger">{state.message}</span>}
      </ActionCard>
      {state.kind === 'not-configured' && (
        <button type="button" className="btn-plain" onClick={onOpenSetup}>
          Open Settings
        </button>
      )}

      {state.kind === 'ready' && (
        <div className="drafts">
          {state.drafts.map((draft) => (
            <div className="draft" key={draft.id}>
              <p className="draft-question">
                {draft.question}
                {draft.saved && <span className="pill pill-neutral">saved answer</span>}
              </p>
              {draft.error ? (
                <span className="pill pill-danger">{draft.error}</span>
              ) : (
                <>
                  <textarea value={draft.text} onChange={(e) => updateDraft(draft.id, { text: e.target.value })} />
                  {draft.insertError && <span className="pill pill-danger">{draft.insertError}</span>}
                  {draft.saveState === 'error' && draft.saveError && (
                    <span className="pill pill-danger">{draft.saveError}</span>
                  )}
                  <div className="draft-actions">
                    <button className="btn btn-primary" onClick={() => handleInsert(draft.id, draft.text)}>
                      {draft.inserted ? 'Inserted' : 'Insert'}
                    </button>
                    <button
                      className="btn"
                      onClick={() => handleSaveReusable(draft.id, draft.question, draft.text)}
                      disabled={draft.saveState === 'saving'}
                    >
                      {draft.saveState === 'saved'
                        ? 'Saved'
                        : draft.saveState === 'saving'
                          ? 'Saving…'
                          : draft.saveState === 'error'
                            ? 'Retry save'
                            : 'Save for reuse'}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function DailyView({ onOpenSetup }: { onOpenSetup: () => void }) {
  return (
    <div className="daily-actions">
      <FillAndAttachSection onOpenSetup={onOpenSetup} />
      <LogToNotionSection onOpenSetup={onOpenSetup} />
      <DraftAnswersCard onOpenSetup={onOpenSetup} />
    </div>
  );
}
