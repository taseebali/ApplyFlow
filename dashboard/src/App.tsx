import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  askExtension,
  stateFor,
  wordingOutcomes,
  type ConnectionState,
  type EditableProperties,
  type TransferableRecord,
} from './bridge';
import { Connection } from './Connection';
import { DetailPanel } from './DetailPanel';
import { Toolbar } from './Toolbar';
import { BoardView, GalleryView, TableView } from './views';
import {
  EMPTY_QUERY,
  allTags,
  applyQuery,
  defaultDirectionFor,
  summarize,
  weeklyVolume,
  type Query,
  type SortKey,
  type ViewKind,
} from './records';

/**
 * Which view and which filters were last used.
 *
 * `localStorage` rather than the record store: this is how one person likes to
 * look at the page, not part of the data, and it has no business travelling to
 * the extension. A read that throws — private mode, blocked site data — must
 * not take the page down with it, so both sides are wrapped.
 */
const VIEW_KEY = 'applyflow.view';

function storedView(): ViewKind {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    return saved === 'board' || saved === 'gallery' ? saved : 'table';
  } catch {
    return 'table';
  }
}

/**
 * Which application is open, in the URL.
 *
 * The panel is a place, so it gets an address: the back button closes it, a
 * reload reopens it, and a link to one application is a link someone can keep.
 * The hash rather than a query parameter because the dashboard is a static
 * page with no router and no server to answer a path.
 */
function selectedFromHash(): string | null {
  return window.location.hash.startsWith('#/a/') ? decodeURIComponent(window.location.hash.slice(4)) : null;
}

export function App() {
  const [records, setRecords] = useState<TransferableRecord[] | null>(null);
  const [connection, setConnection] = useState<ConnectionState>({ kind: 'checking' });
  const [query, setQuery] = useState<Query>(EMPTY_QUERY);
  const [view, setView] = useState<ViewKind>(storedView);
  const [selected, setSelected] = useState<string | null>(selectedFromHash);
  const [dragging, setDragging] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    askExtension({ type: 'list' })
      .then((response) => {
        if (response.ok && response.records) {
          setRecords(response.records);
          setConnection({ kind: 'ready' });
        } else {
          setConnection({ kind: 'unreachable' });
        }
      })
      .catch((error) => setConnection(stateFor(error)));
  }, []);

  useEffect(refresh, [refresh]);

  /*
   * Someone who lands on "not installed", installs the extension and comes
   * back should find the page working, not an error with a button on it. A
   * tab regaining focus is the signal for that — cheaper and more accurate
   * than polling, and it costs nothing while the tab sits open.
   */
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [refresh]);

  // The hash is the source of truth for what is open, so Back and Forward both
  // work without the panel and the URL ever disagreeing.
  useEffect(() => {
    const onHashChange = () => setSelected(selectedFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /*
   * How many history entries this page has pushed of its own.
   *
   * Closing the panel should undo the entry that opened it, which is
   * `history.back()`. But someone who arrived on a link straight to an
   * application never pushed anything, and going back from there leaves the
   * site altogether — so that case clears the hash instead.
   */
  const pushed = useRef(0);

  const open = useCallback((id: string | null) => {
    if (id) {
      pushed.current += 1;
      window.location.hash = `/a/${encodeURIComponent(id)}`;
    } else if (pushed.current > 0) {
      pushed.current -= 1;
      window.history.back();
    } else {
      window.location.hash = '';
    }
    setSelected(id);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // A view preference is not worth failing a render over.
    }
  }, [view]);

  // `/` to search, the one shortcut worth having on a page whose main job is
  // finding a row. Ignored while typing, so it never eats a slash in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /**
   * A property change, shown at once and written behind it.
   *
   * The list is patched locally rather than re-fetched: a board card that
   * jumps columns only after a round trip reads as lag, and every record is
   * already on this machine. `refresh` still runs afterwards, so anything the
   * extension normalised on the way in (a trimmed tag, a capped string) comes
   * back and replaces the guess.
   */
  const save = useCallback(
    (id: string, patch: Partial<EditableProperties>) => {
      setRecords((current) =>
        current ? current.map((record) => (record.id === id ? { ...record, ...patch } : record)) : current
      );
      askExtension({ type: 'set-properties', id, properties: patch })
        .then(refresh)
        .catch((error) => setConnection(stateFor(error)));
    },
    [refresh]
  );

  const onSort = useCallback((key: SortKey) => {
    setQuery((current) =>
      current.sort === key
        ? { ...current, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { ...current, sort: key, direction: defaultDirectionFor(key) }
    );
  }, []);

  const visible = useMemo(() => (records ? applyQuery(records, query) : []), [records, query]);
  const tags = useMemo(() => (records ? allTags(records) : []), [records]);
  const stats = useMemo(() => summarize(visible), [visible]);
  const volume = useMemo(() => weeklyVolume(visible), [visible]);

  // A link to an application that is no longer there must not leave an empty
  // panel over the list.
  const openRecord = selected && records?.some((record) => record.id === selected) ? selected : null;

  if (connection.kind !== 'ready' || !records) {
    return <Connection state={connection} onRetry={refresh} />;
  }

  const filtering = visible.length !== records.length;

  return (
    <>
      <header className="dash-head">
        <span className="dash-wordmark">Applications</span>
        <span className="dash-count">
          {filtering ? `${visible.length} of ${records.length}` : `${records.length} total`}
        </span>
      </header>

      <main className="dash">
        {records.length === 0 ? (
          <div className="empty">
            <strong>Nothing applied for yet</strong>
            <p className="hint">
              Fill an application with the side panel and it is recorded here — the posting, the
              match, and both documents exactly as they were sent.
            </p>
          </div>
        ) : (
          <>
            <StatRow stats={stats} volume={volume} />

            <Toolbar
              query={query}
              onQuery={setQuery}
              view={view}
              onView={setView}
              tags={tags}
              searchRef={searchRef}
            />

            {visible.length === 0 ? (
              <div className="empty">
                <strong>No application matches</strong>
                <p className="hint">Nothing here fits those filters. Clear one and try again.</p>
              </div>
            ) : view === 'table' ? (
              <TableView
                records={visible}
                selectedId={openRecord}
                onOpen={open}
                query={query}
                onSort={onSort}
              />
            ) : view === 'board' ? (
              <BoardView
                records={visible}
                selectedId={openRecord}
                onOpen={open}
                onMove={(id, status) => save(id, { status })}
                dragging={dragging}
                onDragging={setDragging}
              />
            ) : (
              <GalleryView records={visible} selectedId={openRecord} onOpen={open} />
            )}

            <Wording records={visible} />
          </>
        )}
      </main>

      {openRecord && (
        <DetailPanel id={openRecord} onClose={() => open(null)} onChanged={save} />
      )}
    </>
  );
}

function StatRow({
  stats,
  volume,
}: {
  stats: ReturnType<typeof summarize>;
  volume: number[];
}) {
  const peak = Math.max(1, ...volume);

  return (
    <section className="stat-row" aria-label="Summary">
      <div className="stat">
        <span className="stat-label">Applications</span>
        <span className="stat-value">{stats.total}</span>
        {/* Twelve weeks of volume. Bars rather than a line: each week is a
            count, and a line between counts would draw values in between that
            never existed. */}
        <span className="spark" role="img" aria-label={`${stats.last30Days} in the last 30 days`}>
          {volume.map((count, i) => (
            <span
              key={i}
              className={`spark-bar${i === volume.length - 1 ? ' spark-bar-last' : ''}`}
              style={{ height: `${Math.round((count / peak) * 100)}%` }}
            />
          ))}
        </span>
      </div>

      <div className="stat">
        <span className="stat-label">Replies</span>
        <span className="stat-value">{stats.replied}</span>
        <span className="stat-note">
          {stats.replyRate === null ? 'Nothing sent yet' : `${stats.replyRate}% of what went out`}
        </span>
      </div>

      <div className="stat">
        <span className="stat-label">Interviewing</span>
        <span className="stat-value">{stats.interviewing}</span>
        <span className="stat-note">Right now</span>
      </div>

      <div className="stat">
        <span className="stat-label">Overdue</span>
        <span className={`stat-value${stats.overdue > 0 ? ' stat-value-bad' : ''}`}>{stats.overdue}</span>
        <span className="stat-note">
          {stats.overdue === 0 ? 'Nothing waiting on you' : 'Next actions past their date'}
        </span>
      </div>

      <div className="stat">
        <span className="stat-label">Average match</span>
        <span className="stat-value">{stats.averageScore ?? '—'}</span>
        <span className="stat-note">{stats.averageScore === null ? 'Nothing scored' : 'Out of 100'}</span>
      </div>
    </section>
  );
}

/**
 * Which resume wording gets answered — the question the whole record exists
 * to answer, and one no count of filled fields could ever reach.
 *
 * The ids are the bank's own, shown raw: resolving them to the bullet text
 * would need the bank, which lives in the extension and is not part of this
 * page's protocol.
 */
function Wording({ records }: { records: TransferableRecord[] }) {
  const outcomes = wordingOutcomes(records);
  if (outcomes.length === 0) return null;

  return (
    <section className="wording">
      <h2>Wording that gets replies</h2>
      <p className="hint" style={{ marginBottom: 'var(--space-4)' }}>
        Each bullet variant that has gone out, and how often the application came back. Meaningful
        once the same bullet has been sent a few times.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ padding: '10px var(--space-3)' }}>Bullet variant</th>
              <th style={{ padding: '10px var(--space-3)', width: '90px' }}>Sent</th>
              <th style={{ padding: '10px var(--space-3)', width: '90px' }}>Replied</th>
              <th style={{ padding: '10px var(--space-3)', width: '160px' }}>Rate</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map((outcome) => {
              const rate = Math.round((outcome.replied / outcome.sent) * 100);
              return (
                <tr key={outcome.variantId}>
                  <td className="mono cell-muted">{outcome.variantId}</td>
                  <td className="cell-num">{outcome.sent}</td>
                  <td className="cell-num">{outcome.replied}</td>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="meter">
                        <span className="meter-fill" style={{ width: `${rate}%` }} />
                      </span>
                      <span className="cell-num">{rate}%</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
