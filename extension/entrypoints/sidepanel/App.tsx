import { useEffect, useState } from 'react';
import { DailyView } from '@/components/DailyView';
import { getActiveTabId } from '@/lib/active-tab';
import { SetupView } from '@/components/SetupView';
import { JobContextBar, usePosting } from '@/components/JobContext';
import { PrimaryActionBar, PrimaryActionProvider } from '@/components/PrimaryAction';
import { useStoredTheme } from '@/components/ThemeControl';
import { GearIcon } from '@/components/icons';
import { getSettings } from '@/lib/settings';
import type { GroupId } from '@/lib/setup-groups';
import './App.css';

type View =
  | { kind: 'loading' }
  | { kind: 'daily' }
  | { kind: 'setup'; mode: 'wizard' }
  | { kind: 'setup'; mode: 'tabs'; group?: GroupId; step?: string };

/**
 * The panel's three zones: a header that says which posting this is, a body
 * that scrolls, and one primary action pinned to the bottom edge.
 *
 * The header is the change that matters. The panel never named the job it was
 * working on — every competitor leads with it — and that absence is also how a
 * tailored resume came out with no company in its filename.
 */
function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [tabId, setTabId] = useState<number | null>(null);
  const [posting, setPosting] = usePosting(tabId);
  useStoredTheme();

  useEffect(() => {
    // First run opens the guided wizard instead of the daily view. This keys off an
    // explicit flag rather than whether the profile has content: every wizard step is
    // skippable, and a user who skipped them all would otherwise be returned to step 1
    // forever with no way out.
    void getSettings().then((settings) => {
      setView(settings.setupCompleted ? { kind: 'daily' } : { kind: 'setup', mode: 'wizard' });
    });
    void getActiveTabId().then(setTabId).catch(() => setTabId(null));
  }, []);

  if (view.kind === 'loading') return <div className="loading-state">Loading…</div>;

  const openSetup = (group?: GroupId, step?: string) =>
    setView({ kind: 'setup', mode: 'tabs', group, step });

  const isDaily = view.kind === 'daily';

  return (
    <div className="panel">
      <header className="app-header">
        <div className="app-header-top">
          <h1 className="wordmark">ApplyFlow</h1>
          {isDaily && (
            <button type="button" className="icon-btn" onClick={() => openSetup()} aria-label="Settings">
              <GearIcon />
            </button>
          )}
        </div>
        {isDaily && <JobContextBar posting={posting} onChange={setPosting} />}
      </header>

      <PrimaryActionProvider>
        <main className="panel-body">
          {isDaily ? (
            <DailyView posting={posting} onOpenSetup={openSetup} />
          ) : (
            <SetupView
              mode={view.mode}
              group={view.mode === 'tabs' ? view.group : undefined}
              step={view.mode === 'tabs' ? view.step : undefined}
              onDone={() => setView({ kind: 'daily' })}
            />
          )}
        </main>
        {isDaily && <PrimaryActionBar />}
      </PrimaryActionProvider>
    </div>
  );
}

export default App;
