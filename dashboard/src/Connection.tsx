/**
 * What this page says when it cannot reach the extension.
 *
 * This is the screen most first-time visitors see, and for a page that holds
 * nothing of its own it is the one that has to do the explaining. Each state
 * says what happened, why, and the one thing to do about it — a shared "could
 * not connect" would leave a person to guess between four different problems.
 */
import { ArrowClockwise, Plugs, PlugsConnected } from '@phosphor-icons/react';
import { type ConnectionState, type FailedState } from './bridge';

export function Connection({ state, onRetry }: { state: ConnectionState; onRetry: () => void }) {
  // `ready` never reaches here — App renders the list instead — but narrowing
  // it away is what lets CONTENT be keyed on the failures alone.
  if (state.kind === 'checking' || state.kind === 'ready') {
    return (
      <main className="connect">
        <p className="connect-status">
          <PlugsConnected size={13} aria-hidden="true" /> Looking for ApplyFlow
        </p>
        <h1>Reading your applications</h1>
        <p>Every record lives in the extension on this machine. This page is asking it for them.</p>
      </main>
    );
  }

  return (
    <main className="connect">
      <p className="connect-status">
        <Plugs size={13} aria-hidden="true" /> Not connected
      </p>
      {CONTENT[state.kind]()}
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        <ArrowClockwise size={13} weight="bold" aria-hidden="true" style={{ marginRight: 6 }} />
        Check again
      </button>
      <p className="hint" style={{ marginTop: 'var(--space-6)' }}>
        Nothing on this page is stored here. It has no server, no database and no account — every
        application it shows is read from the extension on this machine, as the page is drawn.
      </p>
    </main>
  );
}

const CONTENT: Record<FailedState['kind'], () => React.ReactNode> = {
  'no-runtime': () => (
    <>
      <h1>Open this from the extension</h1>
      <p>
        The dashboard lives inside ApplyFlow and reads your applications straight from it. Served
        from anywhere else — a dev server, a file on disk — there is nothing for it to read.
      </p>
      <p>
        Open it from the panel: the <strong>dashboard icon</strong> in the header, next to the gear.
        Its real address is{' '}
        <code>chrome-extension://&lt;extension-id&gt;/dashboard/index.html</code>, which you can
        bookmark.
      </p>
    </>
  ),

  'not-installed': () => (
    <>
      <h1>ApplyFlow is not answering</h1>
      <p>
        This page is inside the extension but nothing replied, which usually means the extension was
        reloaded or updated while this tab stayed open.
      </p>
      <p>
        Reload the tab. If that does not do it, check ApplyFlow is still enabled under{' '}
        <code>chrome://extensions</code>.
      </p>
    </>
  ),

  unreachable: () => (
    <>
      <h1>ApplyFlow stopped answering</h1>
      <p>
        The request went out and nothing came back. The extension&rsquo;s background worker is
        allowed to be shut down at any moment, and it usually restarts on the next request.
      </p>
      <p>Check again; if it keeps happening, reload the extension from <code>chrome://extensions</code>.</p>
    </>
  ),
};
