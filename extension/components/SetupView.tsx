import { useEffect, useRef, useState } from 'react';
import {
  CertificationsSection,
  ContactSection,
  EducationSection,
  LanguagesSection,
  LinksSection,
  ProjectsSection,
  SkillsSection,
  WorkHistorySection,
} from './ProfileSections';
import { CustomQASection, LogisticsSection, WorkAuthSection } from './AnswerSections';
import { DocumentsSection, LlmSettingsSection, NotionSettingsSection } from './IntegrationSections';
import {
  ApplicationHistorySection,
  FieldMappingsSection,
  ProfileHistorySection,
} from './HistorySections';
import { ResumeImportSection } from './ResumeImportSection';
import { BankSection } from './BankSection';
import { getBank } from '@/lib/bullet-bank';
import { getDocumentsFolderHandle } from '@/lib/document-store';
import { ThemeControl } from './ThemeControl';
import { useProfileEditor } from './useProfileEditor';
import { Wizard } from './Wizard';
import { BackIcon } from './icons';
import { EMPTY_SETTINGS, getSettings, setSettings, type LlmSettings, type Settings } from '@/lib/settings';
import { missingRequiredFields, REQUIRED_FIELDS } from '@/lib/profile-completeness';
import { SETUP_GROUPS, type GroupId } from '@/lib/setup-groups';
import { devApiKey } from '@/lib/dev-prefill';

export interface SetupStep {
  id: string;
  title: string;
  blurb: string;
  render: () => React.ReactNode;
  /** Shown as skippable in the wizard, so a long setup does not look mandatory. */
  optional?: boolean;
  /**
   * Whether this step now holds something. Only read for optional steps, and
   * only to stop the button saying "Skip" after you have filled the step in.
   */
  filled?: boolean;
}

/**
 * The order the wizard asks in.
 *
 * Import comes first because it is the step that removes the typing —
 * everything after it becomes a review of what was found rather than an empty
 * form. It used to sit third, behind two optional screens, by which point
 * plenty of people had already started typing their address by hand.
 *
 * The documents folder is here, at the end, because it is needed for the two
 * things this does besides filling — attaching a resume and saving a tailored
 * one. Leaving it out on the grounds that a fill does not need it meant a
 * first run that opened with "2 things before you can fill this", which is a
 * bad greeting. The Notion tracker stays out: nothing depends on it, and the
 * readiness line raises it at the moment it matters.
 */
const WIZARD_ORDER = ['ai', 'import', 'basics', 'experience', 'answers', 'bank', 'documents', 'done'];

export function SetupView({
  mode,
  group,
  step,
  onDone,
}: {
  mode: 'wizard' | 'tabs';
  /** Which group to open. Omitted means the list of groups. */
  group?: GroupId;
  /** Which section inside that group to scroll to. */
  step?: string;
  onDone: () => void;
}) {
  const { profile, setProfile, loaded, saveState, save, exportJson, importFile, importError, clearImportError } =
    useProfileEditor();
  const [openGroup, setOpenGroup] = useState<GroupId | null>(group ?? null);
  // Whether this group was opened from the list here, or deep-linked into from
  // somewhere else. Back should undo the step the user actually took: after a
  // deep link that means leaving settings, not landing on a list they never
  // saw. Opening settings from the command palette and pressing Back used to
  // put you on the settings list rather than back where you came from.
  const [cameFromList, setCameFromList] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);

  // The Notion token and the LLM key live here, not inside their sections: the
  // wizard unmounts a step as soon as you press Next, so section-local state
  // would be discarded before anything could persist it. Everything on screen
  // is now saved by the same Save/Finish that saves the profile.
  const [notion, setNotion] = useState<Settings['notion']>(EMPTY_SETTINGS.notion);
  const [llm, setLlm] = useState<LlmSettings>(EMPTY_SETTINGS.llm);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // Only so the wizard's Next/Skip label can tell a generated bank from an
  // empty one. Nothing else on this screen needs it.
  const [hasBank, setHasBank] = useState(false);
  const [hasDocumentsFolder, setHasDocumentsFolder] = useState(false);

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

  useEffect(() => {
    void getBank().then((bank) => setHasBank((bank?.variants.length ?? 0) > 0));
    void getDocumentsFolderHandle().then((handle) => setHasDocumentsFolder(Boolean(handle)));
  }, []);

  useEffect(() => {
    setOpenGroup(group ?? null);
    setCameFromList(false);
  }, [group]);

  // Opening a group swaps the whole body, and a screen reader is told nothing
  // unless focus goes with it.
  useEffect(() => {
    if (openGroup) focusRef.current?.focus();
  }, [openGroup]);

  // Profile and settings are written together, from one place, so neither half
  // can clobber the other. Reaching a Save here means setup has been seen, so
  // the first-run wizard does not reappear even if every step was skipped.
  const persist = async () => {
    // Merged onto what is stored rather than replacing it. This form does not
    // own every setting - the theme is set elsewhere - and a wholesale write
    // silently drops whatever it does not know about.
    const current = await getSettings();
    await Promise.all([save(), setSettings({ ...current, notion, llm, setupCompleted: true })]);
  };

  if (!loaded || !settingsLoaded) return <div className="loading-state">Loading your profile…</div>;

  const steps: SetupStep[] = [
    {
      id: 'import',
      title: 'Start from your resume',
      blurb:
        'One file fills your contact details, work history, education and projects. You review everything before it is used, and nothing leaves this computer.',
      render: () => <ResumeImportSection profile={profile} onChange={setProfile} llm={llm} />,
    },
    {
      id: 'basics',
      title: 'Your contact details',
      blurb: 'The basics almost every application asks for.',
      render: () => (
        <>
          <ContactSection profile={profile} onChange={setProfile} />
          <LinksSection profile={profile} onChange={setProfile} />
        </>
      ),
    },
    {
      id: 'contact',
      title: 'Contact',
      blurb: 'Name, email, phone and where you are.',
      render: () => <ContactSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'experience',
      title: 'Check what was found',
      blurb: 'Everything here came from your resume. Correct anything that came out wrong.',
      render: () => (
        <>
          <WorkHistorySection profile={profile} onChange={setProfile} />
          <EducationSection profile={profile} onChange={setProfile} />
          <ProjectsSection profile={profile} onChange={setProfile} />
          <SkillsSection profile={profile} onChange={setProfile} />
        </>
      ),
    },
    {
      id: 'answers',
      title: 'What forms always ask',
      blurb: 'Work authorisation, notice period and languages — the questions every application repeats.',
      render: () => (
        <>
          <WorkAuthSection profile={profile} onChange={setProfile} />
          <LogisticsSection profile={profile} onChange={setProfile} />
          <LanguagesSection profile={profile} onChange={setProfile} />
        </>
      ),
    },
    {
      id: 'ai',
      title: 'Set up AI first',
      blurb:
        'The next step reads your resume. With a model configured it pulls out your work history and projects; without one it gets your contact details and little else. Bring your own key. Nothing is sent anywhere without it.',
      optional: true,
      filled: Object.values(llm.apiKeys).some((key) => Boolean(key)),
      render: () => <LlmSettingsSection value={llm} onChange={setLlm} />,
    },
    {
      id: 'bank',
      title: 'Tailoring bank',
      blurb:
        'Needs AI set up. Writes several versions of each achievement once, so tailoring a resume later is a matter of choosing rather than generating.',
      optional: true,
      filled: hasBank,
      render: () => <BankSection />,
    },
    {
      id: 'done',
      title: "You're set up",
      blurb:
        'Open this panel on any job application and press Fill this application. The gear icon reopens these settings anytime.',
      render: () => null,
    },

    // Reachable from settings only — none of these are needed to fill a form.
    {
      id: 'work-auth',
      title: 'Work authorisation',
      blurb: 'Yes/no answers and the EEO questions, in the wording the big ATS platforms use.',
      render: () => <WorkAuthSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'logistics',
      title: 'Availability and salary',
      blurb: 'Notice period, relocation, and what you ask for.',
      render: () => <LogisticsSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'links',
      title: 'Links',
      blurb: 'LinkedIn, GitHub, portfolio.',
      render: () => <LinksSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'work',
      title: 'Work history',
      blurb: 'The roles you want to reuse across applications.',
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
      title: 'Projects',
      blurb: 'What the AI draws on when drafting. The more specific, the better the drafts.',
      render: () => <ProjectsSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'skills',
      title: 'Skills and headline',
      blurb: 'The skills line on your resume, in the order you want it read.',
      render: () => <SkillsSection profile={profile} onChange={setProfile} />,
    },
    {
      id: 'certifications',
      title: 'Certifications',
      blurb: 'Named on a tailored resume under their own heading.',
      render: () => <CertificationsSection profile={profile} onChange={setProfile} />,
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
      id: 'learned',
      title: 'Learned fields',
      blurb: 'Fields you have taught ApplyFlow about on specific sites.',
      render: () => <FieldMappingsSection />,
    },
    {
      id: 'documents',
      title: 'Documents folder',
      blurb:
        'Point ApplyFlow at the folder where you keep your resumes and cover letters. It attaches the right one for you, and saves a tailored resume back there.',
      optional: true,
      filled: hasDocumentsFolder,
      render: () => <DocumentsSection />,
    },
    {
      id: 'applications',
      title: 'Application history',
      blurb: 'Everything you have applied to through ApplyFlow, kept on this computer.',
      render: () => <ApplicationHistorySection />,
    },
    {
      id: 'versions',
      title: 'Earlier versions',
      blurb: 'Copies kept automatically before an import replaced anything, so a bad import is not final.',
      render: () => <ProfileHistorySection />,
    },
    {
      id: 'appearance',
      title: 'Appearance',
      blurb: 'The panel follows your system theme unless you tell it otherwise.',
      render: () => (
        <section>
          <h2>Theme</h2>
          <ThemeControl />
          <p className="hint mt-3">
            A browser panel sits beside pages that do not follow your system theme, so following it is a default
            rather than the only option.
          </p>
        </section>
      ),
    },
    {
      id: 'notion',
      title: 'Notion tracker',
      blurb: 'Optional. Connect a Notion database to log every application you send.',
      render: () => <NotionSettingsSection value={notion} onChange={setNotion} />,
    },
  ];

  const byId = new Map(steps.map((s) => [s.id, s]));

  const handleDone = async () => {
    await persist();
    onDone();
  };

  if (mode === 'wizard') {
    return (
      <Wizard
        steps={WIZARD_ORDER.map((id) => byId.get(id)).filter((s): s is SetupStep => Boolean(s))}
        // Written after every step, so abandoning halfway keeps what was
        // entered. The old design wrote once at Finish and lost the session.
        onAdvance={persist}
        onDone={handleDone}
      />
    );
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importFile(file);
  };

  const missing = missingRequiredFields(profile);
  const filledCount = REQUIRED_FIELDS.length - missing.length;
  const current = openGroup ? SETUP_GROUPS.find((g) => g.id === openGroup) : null;

  return (
    <div className="setup">
      <div className="app-header-top">
        <button
          type="button"
          className="icon-btn"
          onClick={() => (current && cameFromList ? setOpenGroup(null) : void handleDone())}
          aria-label={current && cameFromList ? 'Back to settings' : 'Back to the daily view'}
        >
          <BackIcon />
        </button>
        <h2 className="wordmark">{current ? current.title : 'Settings'}</h2>
      </div>

      {importError && <p className="error">{importError}</p>}

      {!current ? (
        <>
          {/* Completeness at the top, not buried under an 1800px scroll. */}
          <p className="status-row completeness">
            <span className={`pill ${missing.length ? 'pill-warning' : 'pill-success'}`}>
              {filledCount}/{REQUIRED_FIELDS.length} required fields
            </span>
            {missing.length > 0 && <span className="hint">Missing: {missing.map((f) => f.label).join(', ')}</span>}
          </p>

          <section className="import-lead">
            <h2>Start from your resume</h2>
            <p className="hint">
              Fills your contact details, work history, education and projects from one file. You review
              everything before it is used, and nothing leaves this computer.
            </p>
            <ResumeImportSection profile={profile} onChange={setProfile} llm={llm} />
          </section>

          <nav className="action-rows" aria-label="Settings">
            {SETUP_GROUPS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="action-row action-row-main group-row"
                onClick={() => {
                  setOpenGroup(entry.id);
                  setCameFromList(true);
                }}
              >
                <span className="action-row-body">
                  <span className="action-row-title">{entry.title}</span>
                  <span className="action-row-desc">{entry.blurb}</span>
                </span>
                <span className="action-row-status">
                  {entry.id === 'profile' && missing.length > 0 && (
                    <span className="pill pill-warning">{missing[0]!.label}</span>
                  )}
                </span>
              </button>
            ))}
          </nav>

          <p className="hint">Everything is stored on this computer. Nothing is uploaded.</p>

          <div className="actions mt-4">
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
          </div>
        </>
      ) : (
        <div ref={focusRef} tabIndex={-1} className="setup-group">
          {current.steps.map((id) => {
            const section = byId.get(id);
            if (!section) return null;
            return (
              <div key={id} id={`setup-${id}`} className={step === id ? 'setup-section-target' : undefined}>
                {section.render()}
              </div>
            );
          })}

          <div className="actions mt-4">
            <button type="button" className="btn btn-primary" onClick={persist}>
              {saveState === 'saved' ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
