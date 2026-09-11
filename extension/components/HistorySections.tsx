import { useEffect, useState } from 'react';
import { clearFieldOverrides, getFieldOverrides, type FieldOverrides } from '@/lib/field-overrides';
import { getSnapshots, restoreSnapshot, type ProfileSnapshot } from '@/lib/storage';
import { listRecords } from '@/lib/application-db';
import { summarize, type ApplicationStats } from '@/lib/application-record';

/** Where the full history — the list, detail, and status changes — actually lives. */
const DASHBOARD_URL = 'https://applyflow-dashboard.vercel.app/';

/**
 * What ApplyFlow has recorded: taught fields, earlier profiles, applications.
 */

/**
 * Taught field mappings are otherwise invisible once saved — this makes them
 * reviewable, and undoable when a mapping turns out to be wrong.
 */
export function FieldMappingsSection() {
  const [overrides, setOverrides] = useState<FieldOverrides>({});
  const [loaded, setLoaded] = useState(false);

  const reload = () => getFieldOverrides().then(setOverrides);
  useEffect(() => {
    reload().finally(() => setLoaded(true));
  }, []);

  const forget = async (hostname: string) => {
    await clearFieldOverrides(hostname);
    await reload();
  };

  if (!loaded) return null;
  const hosts = Object.keys(overrides).sort();

  return (
    <section>
      <h2>Learned fields</h2>
      <p className="hint">
        Fields you have told ApplyFlow about on specific sites. It uses these before guessing from labels.
      </p>
      {hosts.length === 0 ? (
        <p className="hint mb-0">
          Nothing learned yet. After filling a page, any field it could not place can be taught from the panel.
        </p>
      ) : (
        hosts.map((host) => (
          <div className="entry" key={host}>
            <strong className="text-base">{host}</strong>
            {Object.entries(overrides[host] ?? {}).map(([signature, path]) => (
              <p key={signature} className="hint mt-2">
                {signature} → {path}
              </p>
            ))}
            <button type="button" className="btn btn-danger remove" onClick={() => forget(host)}>
              Forget these
            </button>
          </div>
        ))
      )}
    </section>
  );
}

/**
 * Earlier copies of the profile, kept automatically before anything replaces
 * it wholesale. Without this an unlucky import is final, which is exactly the
 * fear that stops people using the import that saves them the typing.
 */
export function ProfileHistorySection() {
  const [snapshots, setSnapshots] = useState<ProfileSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => void getSnapshots().then(setSnapshots);
  useEffect(load, []);

  const restore = async (takenAt: number) => {
    setBusy(true);
    try {
      const ok = await restoreSnapshot(takenAt);
      setMessage(
        ok
          ? 'Restored. Reopen Setup to see the restored details — the current version was saved first, so this is reversible.'
          : 'That version is no longer available.'
      );
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Earlier versions</h2>
      <p className="hint">
        A copy is kept automatically before a resume or JSON import replaces anything. The five most recent are
        stored, on this computer only.
      </p>

      {snapshots.length === 0 && <p className="hint">No earlier versions yet.</p>}

      <div className="doc-results">
        {snapshots.map((snapshot) => (
          <div className="doc-row" key={snapshot.takenAt}>
            <span className="doc-row-label">
              {new Date(snapshot.takenAt).toLocaleString()} — {snapshot.reason}
            </span>
            <button type="button" className="btn" disabled={busy} onClick={() => void restore(snapshot.takenAt)}>
              Restore
            </button>
          </div>
        ))}
      </div>

      {message && <p className="hint mt-3">{message}</p>}
    </section>
  );
}

/**
 * Every application put through the tool, kept locally. Answers "is this
 * helping?" — but the panel is 400px and the dashboard is where a history is
 * actually read, so this keeps only the summary and hands the rest over.
 */
export function ApplicationHistorySection() {
  const [stats, setStats] = useState<ApplicationStats | null>(null);

  useEffect(() => {
    void listRecords().then((records) => setStats(summarize(records)));
  }, []);

  return (
    <section>
      <h2>Application history</h2>
      <p className="hint">
        Kept on this computer. Nothing here is sent anywhere — it exists so you can see what you have applied to
        and whether this is saving you anything.
      </p>

      {stats && stats.total === 0 ? (
        <p className="hint">Nothing recorded yet. Fill a page and it will appear here.</p>
      ) : (
        stats && (
          <>
            <p className="status-row mb-3">
              <span className="pill pill-neutral">{stats.total} applications</span>
              <span className="pill pill-neutral">{stats.last30Days} in the last 30 days</span>
              <span className="pill pill-success">{stats.replied} replied</span>
              <span className="pill pill-success">{stats.fieldsFilled} fields filled</span>
              <span className="pill pill-success">{stats.questionsDrafted} answers drafted</span>
            </p>

            {stats.troublesomeSites.length > 0 && (
              <p className="hint">
                Forms that rejected a value: {stats.troublesomeSites.map((s) => `${s.hostname} (${s.invalid})`).join(', ')}.
              </p>
            )}
          </>
        )
      )}

      {/* The panel is 400px. The dashboard is where this is actually read —
          the panel keeps the summary and hands over. */}
      <a className="btn" href={DASHBOARD_URL} target="_blank" rel="noreferrer">
        Open the dashboard
      </a>
    </section>
  );
}
