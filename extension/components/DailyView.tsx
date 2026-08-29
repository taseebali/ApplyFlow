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
import { missingRequiredFields, type RequiredField } from '@/lib/profile-completeness';
import type { StartDraftMessage } from '@/entrypoints/background';
import { getTabState, patchTabState, type AttachOutcome, type DraftEntry } from '@/lib/tab-state';
import { useTabState } from '@/components/useTabState';
import { ActionCard } from '@/components/ActionCard';
import { AttachIcon, DraftIcon, FillIcon, TrackerIcon } from '@/components/icons';

type DocStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'no-folder' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; resume: DocumentMatchResult; coverLetter: DocumentMatchResult };

const DOC_LABELS: Record<DocumentKind, string> = { resume: 'Resume', coverLetter: 'Cover letter' };

export async function getActiveTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found. Open a job application page first.');
  return tab.id;
}

function FillAndAttachSection({ onOpenSetup }: { onOpenSetup: () => void }) {
  // Results live with the tab, not with the panel: each application has its own
  // tab, and the panel is shared between them. Only work that is in flight
  // right now stays local, since a request cannot be resumed after a switch.
  const { tabId, state: tabState } = useTabState();
  const [busyTab, setBusyTab] = useState<number | null>(null);
  const [pending, setPending] = useState<Partial<Record<DocumentKind, true>>>({});
  const [docStatus, setDocStatus] = useState<DocStatus>({ kind: 'idle' });
  const [missing, setMissing] = useState<RequiredField[]>([]);

  const fill = tabState.fill;
  const attachResults = tabState.attach?.results ?? {};
  const attachError = tabState.attach?.error ?? null;
  const filling = busyTab !== null && busyTab === tabId;

  // The matched files carry live file handles, which cannot be stored, so the
  // scan is component-local and re-run per tab. It is cheap, and the outcome of
  // an actual attach - the part worth keeping - lives in tab state.
  useEffect(() => {
    setDocStatus({ kind: 'idle' });
    setPending({});
  }, [tabId]);

  // Filling with an incomplete profile leaves required boxes blank, which the
  // user would otherwise only discover when the application refuses to submit.
  // Re-read on storage changes so finishing setup clears the warning without a
  // panel reload.
  useEffect(() => {
    const refresh = () => void getProfile().then((p) => setMissing(missingRequiredFields(p)));
    refresh();
    browser.storage.local.onChanged.addListener(refresh);
    return () => browser.storage.local.onChanged.removeListener(refresh);
  }, []);

  // A multi-page application swaps the form underneath us. The background
  // worker marks the stored fill stale; the panel only has to drop its scan of
  // a page that is no longer showing.
  useEffect(() => {
    const onMessage = (message: { type?: string }) => {
      if (message?.type !== 'page-changed') return;
      setDocStatus({ kind: 'idle' });
      setPending({});
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  const handleFillClick = async () => {
    // Resolved once and written back explicitly: if the user switches tabs while
    // this runs, the result must still land on the tab that was filled.
    const target = await getActiveTabId();
    setBusyTab(target);
    try {
      const message: FillPageMessage = { type: 'fill-page' };
      const response: FillPageResponse = await browser.tabs.sendMessage(target, message);
      await patchTabState(target, {
        fill: {
          status: 'done',
          filledCount: response.filledCount,
          unmatchedCount: response.unmatchedCount,
          unmatchedLabels: response.unmatchedLabels,
          unrecognized: response.unrecognized,
          hostname: response.hostname,
        },
      });
    } catch (err) {
      await patchTabState(target, {
        fill: { status: 'error', message: err instanceof Error ? err.message : 'Could not fill this page.' },
      });
    } finally {
      setBusyTab((prev) => (prev === target ? null : prev));
    }
  };

  const recordAttach = async (
    target: number,
    outcomes: Partial<Record<DocumentKind, AttachOutcome>>,
    error?: string
  ) => {
    const existing = (await getTabState(target)).attach?.results ?? {};
    await patchTabState(target, { attach: { results: { ...existing, ...outcomes }, error } });
  };

  const attachDocuments = async (entries: Array<{ kind: DocumentKind; folderFile: FolderFile }>, target: number) => {
    setPending((prev) => {
      const next = { ...prev };
      for (const e of entries) next[e.kind] = true;
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
      const response: AttachDocumentsResponse = await browser.tabs.sendMessage(target, message);

      const outcomes: Partial<Record<DocumentKind, AttachOutcome>> = {};
      for (const e of entries) outcomes[e.kind] = response.attached[e.kind] ?? { ok: false };

      // Say why, not just that it failed — attaching cannot be tested outside
      // a real browser, so the reason is what makes a miss diagnosable.
      const failure = entries
        .map((e) => response.attached[e.kind])
        .find((outcome) => outcome && !outcome.ok && outcome.reason);
      await recordAttach(target, outcomes, failure?.reason);
    } catch {
      // `sendMessage` rejects outright when no content script is listening — a
      // chrome:// page, a PDF viewer, or a tab that was already open when the
      // extension was installed. Say so instead of leaving a dead button.
      const outcomes: Partial<Record<DocumentKind, AttachOutcome>> = {};
      for (const e of entries) outcomes[e.kind] = { ok: false };
      await recordAttach(
        target,
        outcomes,
        'Could not reach this page. Reload the job application tab, then try again.'
      );
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        for (const e of entries) delete next[e.kind];
        return next;
      });
    }
  };

  const handleCheckDocuments = async () => {
    setDocStatus({ kind: 'loading' });
    const target = await getActiveTabId();
    await patchTabState(target, { attach: undefined });
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

      const jobInfoMessage: GetJobInfoMessage = { type: 'get-job-info' };
      const jobInfo: GetJobInfoResponse = await browser.tabs.sendMessage(target, jobInfoMessage);

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
        await attachDocuments(autoAttachEntries, target);
      }
    } catch (err) {
      setDocStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not check documents.' });
    }
  };

  const handleConfirmAttach = async (kind: DocumentKind, folderFile: FolderFile) => {
    const target = await getActiveTabId();
    await attachDocuments([{ kind, folderFile }], target);
  };

  return (
    <>
      {missing.length > 0 && (
        <div className="notice notice-warning">
          <p>
            Missing from your profile: <strong>{missing.map((f) => f.label).join(', ')}</strong>. Applications
            almost always require these.
          </p>
          <button type="button" className="btn" onClick={onOpenSetup}>
            Complete profile
          </button>
        </div>
      )}
      <ActionCard
        icon={<FillIcon />}
        title="Fill this page"
        description="Fills the form from your saved profile."
        tint="blue"
        onClick={handleFillClick}
        disabled={filling}
      >
        {filling && <span className="pill pill-neutral">Filling…</span>}
        {!filling && fill?.status === 'done' && (
          <>
            {fill.stale ? (
              <span className="pill pill-warning">This page changed — fill it too</span>
            ) : (
              <>
                <span className={`pill ${fill.unmatchedCount > 0 ? 'pill-warning' : 'pill-success'}`}>
                  {fill.filledCount} filled
                </span>
                {fill.unmatchedCount > 0 && (
                  <span className="pill pill-neutral">{fill.unmatchedCount} need attention</span>
                )}
                {fill.unmatchedLabels.length > 0 && (
                  <span className="unmatched-labels" title="Recognized but has no data in your profile yet">
                    {fill.unmatchedLabels.join(' · ')}
                  </span>
                )}
              </>
            )}
          </>
        )}
        {!filling && fill?.status === 'error' && <span className="pill pill-danger">{fill.message}</span>}
      </ActionCard>

      {fill?.status === 'done' && !fill.stale && fill.unrecognized.length > 0 && (
        <TeachFieldsPanel fields={fill.unrecognized} hostname={fill.hostname} onTaught={handleFillClick} />
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
            const outcome = attachResults[kind];
            const state = pending[kind]
              ? 'pending'
              : outcome === undefined
                ? undefined
                : outcome.ok
                  ? 'attached'
                  : 'failed';
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
  // null until settings are read, so the card does not flash into view for
  // someone who has skipped the tracker.
  const [skipped, setSkipped] = useState<boolean | null>(null);

  useEffect(() => {
    const refresh = () => void getSettings().then((s) => setSkipped(s.notion.skipped));
    refresh();
    browser.storage.local.onChanged.addListener(refresh);
    return () => browser.storage.local.onChanged.removeListener(refresh);
  }, []);

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

  if (skipped !== false) return null;

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
  // Drafts live in the tab's own state, written by the background worker.
  // The panel is a view onto that run rather than its owner, so switching to
  // another application and back shows this one's answers — finished, or
  // still arriving.
  const { tabId, state: tabState, patch } = useTabState();
  const run = tabState.draft;
  const [starting, setStarting] = useState(false);

  const handleDraft = async () => {
    if (tabId === null) return;
    setStarting(true);
    try {
      const message: StartDraftMessage = { type: 'start-draft', tabId };
      await browser.runtime.sendMessage(message);
    } finally {
      setStarting(false);
    }
  };

  const updateDraft = (id: string, updates: Partial<DraftEntry>) => {
    if (!run) return;
    void patch({
      draft: { ...run, entries: run.entries.map((e) => (e.id === id ? { ...e, ...updates } : e)) },
    });
  };

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
    updateDraft(id, { insertError: undefined });
    try {
      await queueProfileSave(question, answer);
      updateDraft(id, { saved: true });
    } catch (err) {
      updateDraft(id, {
        insertError: err instanceof Error ? err.message : 'Could not save this answer.',
      });
    }
  };

  const running = starting || run?.status === 'running';
  const needsSetup = run?.status === 'error' && /Settings/i.test(run.message ?? '');

  return (
    <>
      <ActionCard
        icon={<DraftIcon />}
        title="Draft answers"
        description="Drafts replies to open-ended questions. You review before anything is entered."
        tint="neutral"
        onClick={handleDraft}
        disabled={running}
      >
        {running && (
          <span className="pill pill-neutral">
            {run?.total
              ? `Drafting ${Math.min(run.done + 1, run.total)} of ${run.total}…`
              : 'Looking for questions…'}
          </span>
        )}
        {run?.status === 'done' && <span className="pill pill-success">{run.entries.length} drafted</span>}
        {run?.status === 'error' && <span className="pill pill-danger">{run.message}</span>}
      </ActionCard>
      {needsSetup && (
        <button type="button" className="btn-plain" onClick={onOpenSetup}>
          Open Settings
        </button>
      )}

      {run && run.entries.length > 0 && (
        <div className="drafts">
          {run.entries.map((draft) => (
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
                  <div className="draft-actions">
                    <button className="btn btn-primary" onClick={() => handleInsert(draft.id, draft.text)}>
                      {draft.inserted ? 'Inserted' : 'Insert'}
                    </button>
                    <button
                      className="btn"
                      onClick={() => handleSaveReusable(draft.id, draft.question, draft.text)}
                    >
                      {draft.saved ? 'Saved' : 'Save for reuse'}
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
