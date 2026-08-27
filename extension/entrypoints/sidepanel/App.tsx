import { useEffect, useState } from 'react';
import { DailyView } from '@/components/DailyView';
import { SetupView } from '@/components/SetupView';
import { GearIcon } from '@/components/icons';
import { getSettings } from '@/lib/settings';
import './App.css';

type View = { kind: 'loading' } | { kind: 'daily' } | { kind: 'setup'; mode: 'wizard' | 'tabs' };

function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    // First run opens the guided wizard instead of the daily view. This keys off an
    // explicit flag rather than whether the profile has content: every wizard step is
    // skippable, and a user who skipped them all would otherwise be returned to step 1
    // forever with no way out.
    getSettings().then((settings) => {
      setView(settings.setupCompleted ? { kind: 'daily' } : { kind: 'setup', mode: 'wizard' });
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
