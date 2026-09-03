import { useEffect, useRef, useState } from 'react';
import {
  ContactSection,
  CustomQASection,
  DocumentsSection,
  EducationSection,
  LinksSection,
  LlmSettingsSection,
  LogisticsSection,
  FieldMappingsSection,
  ApplicationHistorySection,
  ProfileHistorySection,
  NotionSettingsSection,
  LanguagesSection,
  ProjectsSection,
  WorkAuthSection,
  WorkHistorySection,
} from './ProfileForm';
import { ResumeImportSection } from './ResumeImportSection';
import { BankSection } from './BankSection';
import { useProfileEditor } from './useProfileEditor';
import { Wizard } from './Wizard';
import { BackIcon } from './icons';
import { EMPTY_SETTINGS, getSettings, setSettings, type LlmSettings, type Settings } from '@/lib/settings';
import { missingRequiredFields, REQUIRED_FIELDS } from '@/lib/profile-completeness';
import { devApiKey } from '@/lib/dev-prefill';

export interface SetupStep {
  id: string;
  title: string;
  blurb: string;
  render: () => React.ReactNode;
}

export function SetupView({ mode, onDone }: { mode: 'wizard' | 'tabs'; onDone: () => void }) {
  const { profile, setProfile, loaded, saveState, save, exportJson, importFile, importError, clearImportError } =
    useProfileEditor();
  const [activeTab, setActiveTab] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The Notion token and the LLM key live here, not inside their sections: the
  // wizard unmounts a step as soon as you press Next, so section-local state
  // would be discarded before anything could persist it. Everything on screen
  // is now saved by the same Save/Finish that saves the profile.
  const [notion, setNotion] = useState<Settings['notion']>(EMPTY_SETTINGS.notion);
  const [llm, setLlm] = useState<LlmSettings>(EMPTY_SETTINGS.llm);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    getSettings().then((settings) => {
      setNotion(settings.notion);
      // In a dev build only, and only when nothing is saved yet, prefill the
      // key from .env.local so a cleared profile does not mean re-pasting it.
      // Compiled out of release builds entirely - see lib/dev-prefill.ts.
      const devKey = devApiKey();
      setLlm(
        devKey && !settings.llm.apiKeys.openrouter
          ? { ...settings.llm, apiKeys: { ...settings.llm.apiKeys, openrouter: devKey } }
          : settings.llm
      );
      setSettingsLoaded(true);
    });
  }, []);

  // Profile and settings are written together, from one place, so neither half
  // can clobber the other. Reaching a Save here means setup has been seen, so
  // the first-run wizard does not reappear even if every step was skipped.
  const persist = async () => {
    await Promise.all([save(), setSettings({ notion, llm, setupCompleted: true })]);
  };

  if (!loaded || !settingsLoaded) return <div className="loading-state">Loading your profile…</div>;

  const steps: SetupStep[] = [
    {
      id: 'welcome',
      title: 'Welcome to ApplyFlow',
      blurb:
        'Save your details once, then fill any job application with a click. Everything stays on this computer. You can skip any step and come back later.',
      render: () => null,
    },
    {
      id: 'ai',
      title: 'AI answer drafting',
      blurb:
        'Optional, and it comes first because it also makes the next step better: with AI set up, importing a resume pulls out work history and projects, not just contact details.',
      render: () => <LlmSettingsSection value={llm} onChange={setLlm} />,
    },
    {
      id: 'import',
      title: 'Start from your resume',
      blurb: 'Optional, but it saves most of the typing ahead. You review everything before it is used.',
      render: () => <ResumeImportSection profile={profile} onChange={setProfile} llm={llm} />,
    },
    {
      id: 'contact',
      title: 'Your contact details',
      blurb: 'The basics almost every application asks for.',
      render: () => <ContactSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'work',
      title: 'Where have you worked?',
      blurb: 'Add the roles you want to reuse across applications.',
      render: () => <WorkHistorySection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'education',
      title: 'Education',
      blurb: 'Schools, degrees, and dates.',
      render: () => <EducationSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'projects',
      title: 'Your projects',
      blurb: 'Details here are what the AI draws on when drafting answers. The more specific, the better the drafts.',
      render: () => <ProjectsSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'bank',
      title: 'Tailoring bank',
      blurb:
        'Optional, and it needs AI set up. Writes several versions of each achievement once, so tailoring a resume later is a matter of choosing rather than generating.',
      render: () => <BankSection />,
    },
    {
      id: 'languages',
      title: 'Languages',
      blurb: 'Applications ask for these constantly, usually on the CEFR scale.',
      render: () => <LanguagesSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'saved-answers',
      title: 'Saved answers',
      blurb: 'Answers you have kept to reuse. AI drafting checks these first, before generating anything new.',
      render: () => <CustomQASection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'preferences',
      title: 'Job preferences',
      blurb: 'Links, work authorization, and availability.',
      render: () => (
        <>
          <LinksSection profile={profile} onChange={setProfile} />
          <WorkAuthSection profile={profile} onChange={setProfile} />
          <LogisticsSection profile={profile} onChange={setProfile} />
        </>
      ),
    },
    {
      id: 'documents',
      title: 'Your documents folder',
      blurb:
        'Point ApplyFlow at the folder where you keep your resumes and cover letters, and it can attach the right one for you. Optional.',
      render: () => <DocumentsSection />,
    },
    {
      id: 'applications',
      title: 'Application history',
      blurb: 'Everything you have applied to through ApplyFlow, kept on this computer.',
      render: () => <ApplicationHistorySection />,
    },
    {
      id: 'history',
      title: 'Earlier versions',
      blurb: 'Copies kept automatically before an import replaced anything, so a bad import is not final.',
      render: () => <ProfileHistorySection />,
    },
    {
      id: 'learned',
      title: 'Learned fields',
      blurb: 'Fields you have taught ApplyFlow about on specific sites. Nothing to do here until you teach one.',
      render: () => <FieldMappingsSection />,
    },
    {
      id: 'notion',
      title: 'Notion tracker',
      blurb: 'Optional. Connect a Notion database to log every application you send.',
      render: () => <NotionSettingsSection value={notion} onChange={setNotion} />,
    },
    {
      id: 'done',
      title: "You're set up",
      blurb: 'Open this panel on any job application and press Fill this page. The gear icon reopens these settings anytime.',
      render: () => null,
    },
  ];

  const handleDone = async () => {
    await persist();
    onDone();
  };

  if (mode === 'wizard') {
    // "Learned fields" is always empty during first-run setup, so it would be
    // a step with nothing to do. It stays available as a tab afterwards.
    return <Wizard steps={steps.filter((s) => !['learned', 'history', 'applications'].includes(s.id))} onDone={handleDone} />;
  }

  // Tabs mode: same steps minus the wizard-only welcome/done screens.
  const tabs = steps.filter((s) => s.id !== 'welcome' && s.id !== 'done');
  const active = tabs[activeTab];

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importFile(file);
  };

  const missing = missingRequiredFields(profile);
  const filledCount = REQUIRED_FIELDS.length - missing.length;

  return (
    <div className="setup-tabs">
      <div className="app-header">
        <button type="button" className="icon-btn" onClick={handleDone} aria-label="Back">
          <BackIcon />
        </button>
        <span className="wordmark">Setup</span>
      </div>

      <div className="tab-bar">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            type="button"
            className={`tab ${i === activeTab ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {tab.title}
          </button>
        ))}
      </div>

      {importError && <p className="error">{importError}</p>}
      {active?.render()}

      <p className="status-row completeness">
        <span className={`pill ${missing.length ? 'pill-warning' : 'pill-success'}`}>
          {filledCount}/{REQUIRED_FIELDS.length} required fields
        </span>
        {missing.length > 0 && <span className="hint">Still missing: {missing.map((f) => f.label).join(', ')}</span>}
      </p>

      <div className="setup-footer">
        <button type="button" className="btn" onClick={exportJson}>
          Export JSON
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            clearImportError();
            fileInputRef.current?.click();
          }}
        >
          Import JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
        <button type="button" className="btn btn-primary" onClick={persist}>
          {saveState === 'saved' ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
}
