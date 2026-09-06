import { useEffect, useState } from 'react';
import { getActiveTabId } from '@/lib/active-tab';
import type { GetJobInfoMessage, GetJobInfoResponse } from '@/entrypoints/content';
import { getSettings } from '@/lib/settings';
import { findExistingApplications, logApplicationToNotion, type ExistingApplication } from '@/lib/notion-client';
import { getTabState, patchTabState } from '@/lib/tab-state';
import { updateApplication } from '@/lib/application-log';
import { useTabState } from '@/components/useTabState';
import { ActionRow } from '@/components/ActionRow';
import { TrackerIcon } from '@/components/icons';

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

export function LogToNotionSection({ onOpenSetup }: { onOpenSetup: OpenSetup }) {
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
      if (tabId !== null) {
        await patchTabState(tabId, { notion: { loggedUrl: url } });
        const applicationId = (await getTabState(tabId)).applicationId;
        if (applicationId) void updateApplication(applicationId, { loggedToNotion: true });
      }
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
      <ActionRow
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
      </ActionRow>
      {!closed && status.kind === 'no-settings' && (
        <button type="button" className="btn-plain" onClick={() => onOpenSetup('history', 'notion')}>
          Set up the Notion tracker
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
              aria-label="Job description"
              value={status.form.jobDescription}
              onChange={(e) => updateForm({ jobDescription: e.target.value })}
              rows={5}
            />
          </label>
          <div className="actions">
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
