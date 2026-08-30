import { useEffect, useState } from 'react';
import type {
  UndoFillMessage,
  UndoFillResponse,
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
import { mergeFillResults, type FrameReport } from '@/lib/frames';
import { recordApplication } from '@/lib/application-log';
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

/**
 * The frames of this tab that hold something fillable, richest first. The
 * worker owns the registry because only it sees each sender's `frameId`.
 */
async function listFillableFrames(tabId: number): Promise<FrameReport[]> {
  try {
    const response = (await browser.runtime.sendMessage({ type: 'get-frames', tabId })) as
      | { frames?: FrameReport[] }
      | undefined;
    return response?.frames ?? [];
  } catch {
    return [];
  }
}

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
  // Folded away by the card's own arrow. View state only: results stay in tab
  // state, so collapsing never discards or re-requests anything.
  const [fillClosed, setFillClosed] = useState(false);
  const [docsClosed, setDocsClosed] = useState(false);

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

  /**
   * Puts every field back the way it was. Filling changes many fields at once
   * on a live application, and until now the only way back was by hand.
   */
  const handleUndo = async () => {
    const target = tabId;
    const entries = fill?.status === 'done' ? (fill.undo ?? []) : [];
    if (target === null || entries.length === 0) return;

    const message: UndoFillMessage = { type: 'undo-fill' };
    let restored = 0;
    for (const entry of entries) {
      try {
        const response: UndoFillResponse = await browser.tabs.sendMessage(
          target,
          message,
          entry.frameId === null ? undefined : { frameId: entry.frameId }
        );
        restored += response.restored;
      } catch {
        // A frame that has gone has nothing left to restore.
      }
    }

    await patchTabState(target, {
      fill: {
        status: 'error',
        message: restored > 0 ? `Undone — ${restored} field${restored === 1 ? '' : 's'} put back.` : 'Nothing to undo.',
      },
    });
  };

  const handleFillClick = async () => {
    // Resolved once and written back explicitly: if the user switches tabs while
    // this runs, the result must still land on the tab that was filled.
    await refill(await getActiveTabId());
  };

  /** Fills one specific tab. Every result is written back against that tab id. */
  const refill = async (target: number | null) => {
    if (target === null) return;
    setBusyTab(target);
    try {
      const message: FillPageMessage = { type: 'fill-page' };

      // An application is often embedded in an iframe, and can legitimately
      // span more than one. Each frame is addressed by id: an un-targeted send
      // reaches every frame but keeps only whichever replies first.
      const frames = await listFillableFrames(target);
      const responses: FillPageResponse[] = [];

      // Which frames were actually written to, so undo can go back to them.
      const written: Array<{ frameId: number | null; fields: number }> = [];

      if (frames.length === 0) {
        // No frame registered — a plain top-level form, or a page whose script
        // has not announced itself yet. Ask the tab directly, as before.
        const response: FillPageResponse = await browser.tabs.sendMessage(target, message);
        responses.push(response);
        written.push({ frameId: null, fields: response.undoable });
      } else {
        for (const frame of frames) {
          try {
            const response: FillPageResponse = await browser.tabs.sendMessage(target, message, {
              frameId: frame.frameId,
            });
            responses.push(response);
            written.push({ frameId: frame.frameId, fields: response.undoable });
          } catch {
            // A frame can vanish between announcing itself and being filled.
            // Skipping it is right; failing the whole run is not.
          }
        }
      }

      if (responses.length === 0) throw new Error('No part of this page could be filled.');

      const merged = mergeFillResults(responses);

      // A local record of what this run actually did, so the tool can answer
      // whether it is helping — and so people who skipped Notion still have a
      // tracker. Never allowed to fail the fill.
      void browser.tabs
        .sendMessage(target, { type: 'get-job-info' } satisfies GetJobInfoMessage)
        .then((info: GetJobInfoResponse) =>
          recordApplication({
            company: info.companyName ?? '',
            title: info.jobTitle ?? '',
            url: info.jobUrl ?? '',
            hostname: responses[0]!.hostname,
            filledCount: merged.filledCount,
            invalidCount: responses.reduce((sum, r) => sum + r.invalid.length, 0),
            questionsDrafted: 0,
            documentsAttached: 0,
            loggedToNotion: false,
          })
        )
        .catch(() => {});
      await patchTabState(target, {
        fill: {
          status: 'done',
          filledCount: merged.filledCount,
          unmatchedCount: merged.unmatchedCount,
          unmatchedLabels: merged.unmatchedLabels,
          unrecognized: merged.unrecognized as FillPageResponse['unrecognized'],
          // Everything written into the form that the user did not type
          // themselves, so they can check it before submitting. An AI-chosen
          // dropdown especially: the option text came from the page.
          autoAnswered: responses.flatMap((response) => [
            ...response.inferred.map((a) => ({ ...a, source: 'profile' as const })),
            ...response.aiChoices.map((a) => ({ ...a, source: 'ai' as const })),
          ]),
          hostname: responses[0]!.hostname,
          frameCount: responses.length,
          undo: written.filter((entry) => entry.fields > 0),
          invalid: responses.flatMap((response) => response.invalid),
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
      // Matches are only ever proposed. Nothing is attached until the user
      // presses the button on a row naming the file: the company name driving
      // the match is scraped from the page being applied to, so letting a
      // confident match skip confirmation would let that page choose which
      // file of the user's leaves the folder.
      setDocStatus({ kind: 'ready', resume, coverLetter });
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
        collapsed={fillClosed}
        onToggleCollapse={() => setFillClosed((v) => !v)}
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
                {(fill.invalid?.length ?? 0) > 0 && (
                  <span
                    className="pill pill-danger"
                    title={fill.invalid!.map((problem) => `${problem.label}: ${problem.reason}`).join(', ')}
                  >
                    {fill.invalid!.length} rejected by the form
                  </span>
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

      {fill?.status === 'done' && !fill.stale && fill.autoAnswered.length > 0 && (
        <div className="auto-answered">
          <p className="teach-intro">Answered for you — worth a look before you submit:</p>
          {fill.autoAnswered.map((answer) => (
            <div className="teach-row" key={`${answer.source}:${answer.label}`}>
              <span className="teach-label" title={answer.label}>
                {answer.label}
              </span>
              <span className={`pill ${answer.source === 'ai' ? 'pill-warning' : 'pill-neutral'}`}>
                {answer.answer}
              </span>
            </div>
          ))}
        </div>
      )}

      {!fillClosed && fill?.status === 'done' && !fill.stale && (fill.undo?.length ?? 0) > 0 && (
        <button type="button" className="btn-plain" onClick={handleUndo}>
          Undo fill
        </button>
      )}

      {!fillClosed && fill?.status === 'done' && !fill.stale && fill.unrecognized.length > 0 && (
        <TeachFieldsPanel
          fields={fill.unrecognized}
          hostname={fill.hostname}
          onTaught={() => void refill(tabId)}
        />
      )}

      <ActionCard
        icon={<AttachIcon />}
        title="Attach documents"
        description="Finds your resume and cover letter, ready for you to attach."
        tint="green"
        onClick={handleCheckDocuments}
        disabled={docStatus.kind === 'loading'}
        collapsed={docsClosed}
        onToggleCollapse={() => setDocsClosed((v) => !v)}
      >
        {docStatus.kind === 'loading' && <span className="pill pill-neutral">Checking…</span>}
        {docStatus.kind === 'no-folder' && (
          <span className="pill pill-neutral">No documents folder linked — set it up in Settings</span>
        )}
        {docStatus.kind === 'error' && <span className="pill pill-danger">{docStatus.message}</span>}
      </ActionCard>
      {!docsClosed && docStatus.kind === 'no-folder' && (
        <button type="button" className="btn-plain" onClick={onOpenSetup}>
          Open Settings
        </button>
      )}
      {!docsClosed && attachError && <span className="pill pill-danger">{attachError}</span>}
      {!docsClosed && docStatus.kind === 'ready' && (
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
            return (
              <div key={kind} className="doc-row">
                <span className="doc-row-label" title={result.file.name}>
                  {label} — {result.file.name}{' '}
                  {result.matchedBy === 'most-recent' && <span className="pill pill-warning">best guess</span>}
                </span>
                <button
                  className="btn"
                  onClick={() => handleConfirmAttach(kind, result.file!)}
                  disabled={state === 'pending'}
                >
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
  const [closed, setClosed] = useState(false);
  // Whether this application was already logged belongs to its tab: coming back
  // to it later must not invite logging the same row twice.
  const { tabId, state: tabState } = useTabState();
  const loggedUrl = tabState.notion?.loggedUrl;

  // A form half-filled for one application means nothing on another.
  useEffect(() => {
    setStatus({ kind: 'idle' });
  }, [tabId]);

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
      if (tabId !== null) await patchTabState(tabId, { notion: { loggedUrl: url } });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not log to Notion.' });
    }
  };

  // The freshly-logged URL is used directly, so the link appears even before the
  // stored copy comes back through the storage listener.
  const rowUrl = status.kind === 'done' ? status.url : loggedUrl;

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
        collapsed={closed}
        onToggleCollapse={() => setClosed((v) => !v)}
      >
        {status.kind === 'loading' && <span className="pill pill-neutral">Reading page…</span>}
        {status.kind === 'logging' && <span className="pill pill-neutral">Logging…</span>}
        {status.kind === 'no-settings' && (
          <span className="pill pill-neutral">Add your Notion integration token in Settings first</span>
        )}
        {status.kind === 'error' && <span className="pill pill-danger">{status.message}</span>}
        {(status.kind === 'done' || (status.kind === 'idle' && loggedUrl)) && (
          <span className="pill pill-success">Logged to Notion</span>
        )}
      </ActionCard>
      {!closed && status.kind === 'no-settings' && (
        <button type="button" className="btn-plain" onClick={onOpenSetup}>
          Open Settings
        </button>
      )}
      {!closed && rowUrl && (
        <a href={rowUrl} target="_blank" rel="noreferrer" className="btn-plain">
          Open row
        </a>
      )}
      {!closed && status.kind === 'form' && (
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
  // Which drafts are folded away. Purely a view preference, so it stays in the
  // component — the answers themselves live in tab state and are never
  // discarded or re-requested by collapsing.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [cardClosed, setCardClosed] = useState(false);
  const run = tabState.draft;
  const [starting, setStarting] = useState(false);

  const handleDraft = async () => {
    if (tabId === null) return;
    setStarting(true);
    try {
      const message: StartDraftMessage = { type: 'start-draft', tabId };
      const response = (await browser.runtime.sendMessage(message)) as { started?: boolean } | undefined;
      // The worker refuses a request that did not come from this panel. That
      // should be unreachable from here, so say so rather than sitting idle.
      if (!response?.started) {
        await patchTabState(tabId, {
          draft: { status: 'error', done: 0, total: 0, entries: [], message: 'Could not start drafting.' },
        });
      }
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

  const entries = run?.entries ?? [];
  const allCollapsed = entries.length > 0 && entries.every((e) => collapsed[e.id]);
  const toggleAll = () =>
    setCollapsed(allCollapsed ? {} : Object.fromEntries(entries.map((e) => [e.id, true])));
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
        collapsed={cardClosed}
        onToggleCollapse={() => setCardClosed((v) => !v)}
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
      {!cardClosed && needsSetup && (
        <button type="button" className="btn-plain" onClick={onOpenSetup}>
          Open Settings
        </button>
      )}

      {!cardClosed && run && run.entries.length > 0 && (
        <div className="drafts">
          <div className="drafts-toolbar">
            <span className="hint">
              {run.entries.length} question{run.entries.length === 1 ? '' : 's'}
            </span>
            <button type="button" className="btn-plain" onClick={toggleAll}>
              {allCollapsed ? 'Expand answers' : 'Collapse answers'}
            </button>
          </div>

          {run.entries.map((draft) => {
            const open = !collapsed[draft.id];
            return (
              <div className="draft" key={draft.id}>
                {/* A button, not a heading with a handler: collapsing has to be
                    reachable by keyboard, and the whole row is the target. */}
                <button
                  type="button"
                  className="draft-question"
                  aria-expanded={open}
                  onClick={() => setCollapsed((prev) => ({ ...prev, [draft.id]: open }))}
                >
                  <span className={`draft-chevron ${open ? 'draft-chevron-open' : ''}`} aria-hidden="true">
                    ▸
                  </span>
                  <span className="draft-question-text">{draft.question}</span>
                  {draft.saved && <span className="pill pill-neutral">saved answer</span>}
                  {!draft.saved && draft.model && (
                    <span
                      className="pill pill-neutral"
                      title="The model that answered — a rotating pool can use a different one per question"
                    >
                      {draft.model}
                    </span>
                  )}
                  {draft.inserted && <span className="pill pill-success">inserted</span>}
                  {draft.error && <span className="pill pill-danger">failed</span>}
                </button>

                {/* Hidden, never unmounted: the drafted text is preserved
                    exactly as it was, including unsaved edits, and nothing is
                    regenerated on reopening. */}
                <div className="draft-body" hidden={!open}>
                  {draft.error ? (
                    <span className="pill pill-danger">{draft.error}</span>
                  ) : (
                    <>
                      <textarea
                        value={draft.text}
                        onChange={(e) => updateDraft(draft.id, { text: e.target.value })}
                      />
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
              </div>
            );
          })}
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
