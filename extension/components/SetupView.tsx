import { useRef, useState } from 'react';
import {
  ContactSection,
  CustomQASection,
  DocumentsSection,
  EducationSection,
  LinksSection,
  LlmSettingsSection,
  LogisticsSection,
  NotionSettingsSection,
  ProjectsSection,
  WorkAuthSection,
  WorkHistorySection,
} from './ProfileForm';
import { useProfileEditor } from './useProfileEditor';
import { Wizard } from './Wizard';
import { BackIcon } from './icons';

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

  if (!loaded) return <div className="loading-state">Loading your profile…</div>;

  const steps: SetupStep[] = [
    {
      id: 'welcome',
      title: 'Welcome to ApplyFlow',
      blurb:
        'Save your details once, then fill any job application with a click. Everything stays on this computer. You can skip any step and come back later.',
      render: () => null,
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
      id: 'notion',
      title: 'Notion tracker',
      blurb: 'Optional. Connect a Notion database to log every application you send.',
      render: () => <NotionSettingsSection />,
    },
    {
      id: 'ai',
      title: 'AI answer drafting',
      blurb: 'Optional. Let a local or hosted model draft answers to open-ended questions.',
      render: () => <LlmSettingsSection />,
    },
    {
      id: 'done',
      title: "You're set up",
      blurb: 'Open this panel on any job application and press Fill this page. The gear icon reopens these settings anytime.',
      render: () => null,
    },
  ];

  const handleDone = async () => {
    await save();
    onDone();
  };

  if (mode === 'wizard') {
    return <Wizard steps={steps} onDone={handleDone} />;
  }

  // Tabs mode: same steps minus the wizard-only welcome/done screens.
  const tabs = steps.filter((s) => s.id !== 'welcome' && s.id !== 'done');
  const active = tabs[activeTab];

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importFile(file);
  };

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
        <button type="button" className="btn btn-primary" onClick={save}>
          {saveState === 'saved' ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
}
