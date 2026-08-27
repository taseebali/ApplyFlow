import { useEffect, useState } from 'react';
import { DailyView } from '@/components/DailyView';
import { SetupView } from '@/components/SetupView';
import { GearIcon } from '@/components/icons';
import { getProfile } from '@/lib/storage';
import './App.css';

type View = { kind: 'loading' } | { kind: 'daily' } | { kind: 'setup'; mode: 'wizard' | 'tabs' };

function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    // First run (nothing saved yet) opens the guided wizard instead of the daily view.
    getProfile().then((profile) => {
      const hasProfile = Boolean(profile.contact.firstName || profile.contact.email);
      setView(hasProfile ? { kind: 'daily' } : { kind: 'setup', mode: 'wizard' });
    });
  }, []);

  if (view.kind === 'loading') return <div className="loading-state">Loading…</div>;

  const isTabsSetup = view.kind === 'setup' && view.mode === 'tabs';

  return (
    <div className="panel">
      {!isTabsSetup && (
        <header className="app-header">
          <span className="wordmark">ApplyFlow</span>
          {view.kind === 'daily' && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setView({ kind: 'setup', mode: 'tabs' })}
              aria-label="Settings"
            >
              <GearIcon />
            </button>
          )}
        </header>
      )}

      {view.kind === 'daily' ? (
        <DailyView onOpenSetup={() => setView({ kind: 'setup', mode: 'tabs' })} />
      ) : (
        <SetupView mode={view.mode} onDone={() => setView({ kind: 'daily' })} />
      )}
    </div>
  );
}

export default App;
