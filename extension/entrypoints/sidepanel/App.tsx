import { useEffect, useState } from 'react';
import { DailyView } from '@/components/DailyView';
import { getActiveTabId } from '@/lib/active-tab';
import { SetupView } from '@/components/SetupView';
import { JobContextBar, usePosting } from '@/components/JobContext';
import { PrimaryActionBar, PrimaryActionProvider } from '@/components/PrimaryAction';
import { useStoredTheme } from '@/components/ThemeControl';
import { CommandPalette, useCommandKey } from '@/components/CommandPalette';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { fieldCommands, type Command } from '@/lib/commands';
import { useFormPlan } from '@/components/FieldMirror';
import { useActiveTab } from '@/components/useActiveTab';
import type { JumpToFieldMessage } from '@/entrypoints/content';
import { frameOf, localId, type PlannedField } from '@/lib/field-plan';
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
  const tabId = useActiveTab();
  const [posting, setPosting] = usePosting(tabId);
  useStoredTheme();

  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandKey(() => setPaletteOpen(true));
  const formPlan = useFormPlan();
  const { plan } = formPlan;

  const jump = (field: PlannedField) => {
    const frameId = frameOf(field.id);
    void getActiveTabId()
      .then((id) =>
        browser.tabs.sendMessage(
          id,
          { type: 'jump-to-field', fieldId: localId(field.id) } satisfies JumpToFieldMessage,
          frameId === null ? {} : { frameId }
        )
      )
      .catch(() => undefined);
  };

  /**
   * Settings live here rather than behind a menu tree, so reaching Appearance
   * is typing "theme" instead of knowing which group it is filed under.
   */
  const commands: Command[] = [
    { id: 'setup', label: 'Open settings', group: 'Settings', keys: '⌘,', run: () => openSetup() },
    { id: 'theme', label: 'Appearance and theme', group: 'Settings', aliases: ['dark mode', 'light'],
      run: () => openSetup('appearance', 'appearance') },
    { id: 'profile', label: 'Edit your profile', group: 'Settings', aliases: ['contact', 'work history'],
      run: () => openSetup('profile', 'contact') },
    { id: 'ai', label: 'AI provider and model', group: 'Settings', aliases: ['openrouter', 'key'],
      run: () => openSetup('ai', 'ai') },
    { id: 'documents', label: 'Documents folder and tailoring bank', group: 'Settings',
      aliases: ['resume', 'bank'], run: () => openSetup('documents', 'documents') },
    ...(plan ? fieldCommands(plan.fields, jump) : []),
  ];

  useEffect(() => {
    // First run opens the guided wizard instead of the daily view. This keys off an
    // explicit flag rather than whether the profile has content: every wizard step is
    // skippable, and a user who skipped them all would otherwise be returned to step 1
    // forever with no way out.
    void getSettings().then((settings) => {
      setView(settings.setupCompleted ? { kind: 'daily' } : { kind: 'setup', mode: 'wizard' });
    });
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
            <>
              <button
                type="button"
                className="cmd-bar"
                onClick={() => setPaletteOpen(true)}
                aria-label="Search fields, run a command"
              >
                <MagnifyingGlassIcon size={15} weight="light" aria-hidden="true" />
                <span>Search or run a command</span>
                <kbd>⌘K</kbd>
              </button>
              <button type="button" className="icon-btn" onClick={() => openSetup()} aria-label="Settings">
                <GearIcon />
              </button>
            </>
          )}
        </div>
        {isDaily && <JobContextBar posting={posting} onChange={setPosting} />}
      </header>

      <PrimaryActionProvider>
        <main className="panel-body">
          {isDaily ? (
            <DailyView posting={posting} onOpenSetup={openSetup} formPlan={formPlan} />
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

      <CommandPalette commands={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default App;
