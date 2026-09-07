import { useEffect, useState } from 'react';
import type { UndoFillMessage, UndoFillResponse, AttachDocumentsMessage, AttachDocumentsResponse, FillPageMessage, FillPageResponse, GetJobInfoMessage, GetJobInfoResponse } from '@/entrypoints/content';
import { ensureReadPermission, getDocumentsFolderHandle } from '@/lib/document-store';
import { findBestMatch, listFolderFiles, type DocumentKind, type DocumentMatchResult, type FolderFile } from '@/lib/document-matcher';
import { getTabState, patchTabState, type AttachOutcome } from '@/lib/tab-state';
import { mergeFillResults } from '@/lib/frames';
import { recordApplication, updateApplication } from '@/lib/application-log';
import { useTabState } from '@/components/useTabState';
import { ActionRow } from '@/components/ActionRow';
import { AttachIcon } from '@/components/icons';
import {
  askFrames,
  listFillableFrames,
  getActiveTabId,
  readJobInfo,
  EMPTY_JOB_INFO,
} from '@/lib/active-tab';
import { TeachFieldsPanel } from '@/components/TeachFieldsPanel';

type DocStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'no-folder' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; resume: DocumentMatchResult; coverLetter: DocumentMatchResult };

const DOC_LABELS: Record<DocumentKind, string> = { resume: 'Resume', coverLetter: 'Cover letter' };

export function FillAndAttachSection({
  onOpenSetup,
}: {
  onOpenSetup: OpenSetup;
}) {
  // Results live with the tab, not with the panel: each application has its own
  // tab, and the panel is shared between them. Only work that is in flight
  // right now stays local, since a request cannot be resumed after a switch.
  const { tabId, state: tabState } = useTabState();
  const [busyTab, setBusyTab] = useState<number | null>(null);
  const [pending, setPending] = useState<Partial<Record<DocumentKind, true>>>({});
  const [docStatus, setDocStatus] = useState<DocStatus>({ kind: 'idle' });
  // Folded away by the card's own arrow. View state only: results stay in tab
  // state, so collapsing never discards or re-requests anything.
  // Set when a fill was refused for an incomplete profile, so the reason is
  // stated at the moment it happens rather than only in the standing notice.
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
        .then(async (info: GetJobInfoResponse) => {
          const entry = await recordApplication({
            company: info.companyName ?? '',
            title: info.jobTitle ?? '',
            url: info.jobUrl ?? '',
            hostname: responses[0]!.hostname,
            filledCount: merged.filledCount,
            invalidCount: responses.reduce((sum, r) => sum + r.invalid.length, 0),
            // Filled in as those steps happen; see updateApplication.
            questionsDrafted: 0,
            documentsAttached: 0,
            loggedToNotion: false,
          });
          await patchTabState(target, { applicationId: entry.id });
        })
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
    const state = await getTabState(target);
    const existing = state.attach?.results ?? {};
    const merged = { ...existing, ...outcomes };
    await patchTabState(target, { attach: { results: merged, error } });

    if (state.applicationId) {
      const attached = Object.values(merged).filter((outcome) => outcome?.ok).length;
      void updateApplication(state.applicationId, { documentsAttached: attached });
    }
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
      // The upload field is usually in the embedded frame, and a frame without
      // one answers "not attached" instantly and would win an untargeted send.
      const response = (await askFrames<AttachDocumentsResponse>(target, message, (result) =>
        Object.values(result.attached).some((outcome) => outcome?.ok)
      )) ?? { attached: {} };

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

      const jobInfo = (await readJobInfo(target)) ?? EMPTY_JOB_INFO;

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
      {/*
        The row this replaces offered "Fill this application", which the sticky
        "Review N changes" button already does — and the mirror above already
        shows what would be written. What the row carried that nothing else did
        is the report of what actually happened, so that is all that is left.
      */}
      {(filling || fill) && (
        <div className="fill-result" role="status" aria-live="polite">
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
                    <span className="pill pill-danger">{fill.invalid!.length} rejected by the form</span>
                  )}
                  {(fill.frameCount ?? 1) > 1 && (
                    <span className="pill pill-neutral">across {fill.frameCount} frames</span>
                  )}
                  {(fill.invalid?.length ?? 0) > 0 && (
                    <span className="unmatched-labels">
                      Rejected: {fill.invalid!.map((problem) => `${problem.label} (${problem.reason})`).join(' · ')}
                    </span>
                  )}
                  {(fill.frameCount ?? 1) > 1 && (
                    <span className="unmatched-labels">
                      This application is split across embedded frames; all of them were filled.
                    </span>
                  )}
                  {fill.unmatchedLabels.length > 0 && (
                    <span className="unmatched-labels">
                      Recognised but not in your profile yet: {fill.unmatchedLabels.join(' · ')}
                    </span>
                  )}
                </>
              )}
            </>
          )}
          {!filling && fill?.status === 'error' && <span className="pill pill-danger">{fill.message}</span>}
        </div>
      )}

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

      {fill?.status === 'done' && !fill.stale && (fill.undo?.length ?? 0) > 0 && (
        <button type="button" className="btn-plain" onClick={handleUndo}>
          Undo fill
        </button>
      )}

      {fill?.status === 'done' && !fill.stale && fill.unrecognized.length > 0 && (
        <TeachFieldsPanel
          fields={fill.unrecognized}
          hostname={fill.hostname}
          onTaught={() => void refill(tabId)}
        />
      )}

      <ActionRow
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
      </ActionRow>
      {!docsClosed && docStatus.kind === 'no-folder' && (
        <button type="button" className="btn-plain" onClick={() => onOpenSetup('documents', 'documents')}>
          Link a documents folder
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
