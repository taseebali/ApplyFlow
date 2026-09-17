/**
 * What this page says when it cannot reach the extension.
 *
 * This is the screen most first-time visitors see, and for a page that holds
 * nothing of its own it is the one that has to do the explaining. Each state
 * says what happened, why, and the one thing to do about it — a shared "could
 * not connect" would leave a person to guess between four different problems.
 */
import { ArrowClockwise, Plugs, PlugsConnected, Warning } from '@phosphor-icons/react';
import { EXTENSION_ID, type ConnectionState, type FailedState } from './bridge';

const PORT = '5174';

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
        Nothing on this page is stored here. It has no server, no database and no account — open it
        without the extension and there is genuinely nothing to show.
      </p>
    </main>
  );
}

const CONTENT: Record<FailedState['kind'], () => React.ReactNode> = {
  'no-runtime': () => (
    <>
      <h1>This browser cannot ask</h1>
      <p>
        The dashboard reaches the extension over <code>chrome.runtime</code>, which only exists in
        Chrome, Brave, Edge and other Chromium browsers — and only on a page served over http or
        https.
      </p>
      <p>
        If this page was opened from a file on disk, serve it instead: <code>npx vite</code> from the{' '}
        <code>dashboard</code> folder.
      </p>
    </>
  ),

  'not-installed': () => (
    <>
      <h1>ApplyFlow is not answering</h1>
      <p>Nothing responded on this extension id. That is one of three things:</p>
      <ol>
        <li>The extension is not installed in this browser.</li>
        <li>
          It is installed but switched off — check <code>chrome://extensions</code>.
        </li>
        <li>
          It is a release build. A published ApplyFlow deliberately trusts no external page at all,
          so only a development build answers this dashboard.
        </li>
      </ol>
      <p className="hint">
        Expected id <span className="mono">{EXTENSION_ID}</span>
      </p>
    </>
  ),

  refused: () => (
    <>
      <h1>ApplyFlow refused this page</h1>
      <p>
        The extension is installed and it answered — it just does not trust this address. It accepts{' '}
        <code>http://localhost:{PORT}</code> and nothing else.
      </p>
      <p>
        If the dev server moved to another port, stop it and start it again on {PORT}; if you are
        running it somewhere else on purpose, that origin has to be added to both{' '}
        <code>externally_connectable</code> in <code>extension/wxt.config.ts</code> and{' '}
        <code>ALLOWED_ORIGINS</code> in <code>extension/lib/dashboard-bridge.ts</code>.
      </p>
      <p className="hint">
        <Warning size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />
        Only ever list a host you have registered. A listed origin can read every application on
        every machine the extension is installed on.
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
