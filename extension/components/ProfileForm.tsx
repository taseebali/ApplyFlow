import { useEffect, useState } from 'react';
import {
  LANGUAGE_LEVELS,
  type CustomQAEntry,
  type EducationEntry,
  type LanguageEntry,
  type Profile,
  type ProjectEntry,
  type WorkHistoryEntry,
} from '@/lib/schema';
import {
  getDocumentsFolderHandle,
  saveDocumentsFolderHandle,
  supportsDocumentsFolder,
} from '@/lib/document-store';
import type { LlmSettings, Settings } from '@/lib/settings';
import { searchDatabases, testConnection, type NotionDatabaseOption } from '@/lib/notion-client';
import { clearFieldOverrides, getFieldOverrides, type FieldOverrides } from '@/lib/field-overrides';
import { LocationFields } from './LocationFields';
import { getSnapshots, restoreSnapshot, type ProfileSnapshot } from '@/lib/storage';
import {
  clearApplications,
  getApplications,
  summarize,
  toCsv,
  type ApplicationEntry,
} from '@/lib/application-log';
import { ModelPicker } from './ModelPicker';
import { PROVIDERS, originPatternFor, providerById } from '@/lib/providers';

export type NotionConfig = Settings['notion'];

/**
 * Marks a field an application cannot be filled without. Empty ones are also
 * counted up on the Fill card, so the warning and the tag agree on what
 * "required" means: see `lib/profile-completeness.ts`.
 */
export function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span>
      {label}
      {required && <span className="required-tag">Required</span>}
    </span>
  );
}

export function TextField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="field">
      <FieldLabel label={label} required={required} />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/**
 * A dropdown for anything an application form would also present as a
 * dropdown. Keeping the wording identical to the standard EEO options used by
 * Greenhouse, Lever and similar means the saved value can be matched against
 * a form's own options instead of being typed as free text.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  required,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="field">
      <FieldLabel label={label} required={required} />
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not set</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {/* A value imported from JSON may predate these options. */}
        {value && !options.includes(value) && <option value={value}>{value}</option>}
      </select>
    </label>
  );
}

const WORK_AUTH_STATUS_OPTIONS = [
  'Citizen',
  'EU citizen',
  'Permanent resident',
  'Work visa holder',
  'Student visa holder',
  'Requires sponsorship',
] as const;

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Decline to self identify'] as const;

const RACE_OPTIONS = [
  'American Indian or Alaska Native',
  'Asian',
  'Black or African American',
  'Hispanic or Latino',
  'Native Hawaiian or Other Pacific Islander',
  'White',
  'Two or More Races',
  'Decline to self identify',
] as const;

const VETERAN_OPTIONS = [
  'I am not a protected veteran',
  'I identify as one or more of the classifications of a protected veteran',
  'I decline to self identify',
] as const;

const DISABILITY_OPTIONS = [
  'Yes, I have a disability, or have had one in the past',
  'No, I do not have a disability',
  'I do not want to answer',
] as const;

export function ContactSection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const c = profile.contact;
  const update = (key: keyof Profile['contact'], value: string) =>
    onChange({ ...profile, contact: { ...c, [key]: value } });

  return (
    <section>
      <h2>Contact</h2>
      <div className="grid">
        <TextField label="First name" required value={c.firstName} onChange={(v) => update('firstName', v)} />
        <TextField label="Last name" required value={c.lastName} onChange={(v) => update('lastName', v)} />
        <TextField label="Email" required value={c.email} onChange={(v) => update('email', v)} />
        <TextField label="Phone" required value={c.phone} onChange={(v) => update('phone', v)} />
        <TextField label="Address line 1" value={c.addressLine1} onChange={(v) => update('addressLine1', v)} />
        <TextField label="Address line 2" value={c.addressLine2} onChange={(v) => update('addressLine2', v)} />
        <TextField label="Postal code" value={c.postalCode} onChange={(v) => update('postalCode', v)} />
      </div>
      <LocationFields
        country={c.country}
        state={c.state}
        city={c.city}
        onChange={(patch) => onChange({ ...profile, contact: { ...c, ...patch } })}
      />
    </section>
  );
}

export function LinksSection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const l = profile.links;
  const update = (key: keyof Profile['links'], value: string) =>
    onChange({ ...profile, links: { ...l, [key]: value } });

  return (
    <section>
      <h2>Links</h2>
      <div className="grid">
        <TextField label="LinkedIn" value={l.linkedin} onChange={(v) => update('linkedin', v)} />
        <TextField label="GitHub" value={l.github} onChange={(v) => update('github', v)} />
        <TextField label="Portfolio" value={l.portfolio} onChange={(v) => update('portfolio', v)} />
        <TextField label="Website" value={l.website} onChange={(v) => update('website', v)} />
      </div>
    </section>
  );
}

export function WorkHistorySection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const update = (id: string, patch: Partial<WorkHistoryEntry>) =>
    onChange({
      ...profile,
      workHistory: profile.workHistory.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    });

  const add = () =>
    onChange({
      ...profile,
      workHistory: [
        ...profile.workHistory,
        {
          id: crypto.randomUUID(),
          company: '',
          title: '',
          location: '',
          startDate: '',
          endDate: '',
          current: false,
          description: '',
        },
      ],
    });

  const remove = (id: string) =>
    onChange({ ...profile, workHistory: profile.workHistory.filter((entry) => entry.id !== id) });

  return (
    <section>
      <h2>Work history</h2>
      {profile.workHistory.map((entry) => (
        <div className="entry" key={entry.id}>
          <div className="grid">
            <TextField label="Company" value={entry.company} onChange={(v) => update(entry.id, { company: v })} />
            <TextField label="Title" value={entry.title} onChange={(v) => update(entry.id, { title: v })} />
            <TextField label="Location" value={entry.location} onChange={(v) => update(entry.id, { location: v })} />
            <TextField
              label="Start date"
              value={entry.startDate}
              onChange={(v) => update(entry.id, { startDate: v })}
            />
            <TextField label="End date" value={entry.endDate} onChange={(v) => update(entry.id, { endDate: v })} />
            <label className="field checkbox">
              <input
                type="checkbox"
                checked={entry.current}
                onChange={(e) => update(entry.id, { current: e.target.checked })}
              />
              <span>Current role</span>
            </label>
          </div>
          <label className="field">
            <span>Description</span>
            <textarea
              value={entry.description}
              onChange={(e) => update(entry.id, { description: e.target.value })}
            />
          </label>
          <button type="button" className="btn btn-danger remove" onClick={() => remove(entry.id)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={add}>
        + Add work history entry
      </button>
    </section>
  );
}

export function EducationSection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const update = (id: string, patch: Partial<EducationEntry>) =>
    onChange({
      ...profile,
      education: profile.education.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    });

  const add = () =>
    onChange({
      ...profile,
      education: [
        ...profile.education,
        { id: crypto.randomUUID(), school: '', degree: '', fieldOfStudy: '', startDate: '', endDate: '', current: false },
      ],
    });

  const remove = (id: string) =>
    onChange({ ...profile, education: profile.education.filter((entry) => entry.id !== id) });

  return (
    <section>
      <h2>Education</h2>
      {profile.education.map((entry) => (
        <div className="entry" key={entry.id}>
          <div className="grid">
            <TextField label="School" value={entry.school} onChange={(v) => update(entry.id, { school: v })} />
            <TextField label="Degree" value={entry.degree} onChange={(v) => update(entry.id, { degree: v })} />
            <TextField
              label="Field of study"
              value={entry.fieldOfStudy}
              onChange={(v) => update(entry.id, { fieldOfStudy: v })}
            />
            <TextField
              label="Start date"
              value={entry.startDate}
              onChange={(v) => update(entry.id, { startDate: v })}
            />
            <TextField
              label={entry.current ? 'Expected end date' : 'End date'}
              value={entry.endDate}
              onChange={(v) => update(entry.id, { endDate: v })}
            />
            <label className="field checkbox">
              <input
                type="checkbox"
                checked={entry.current}
                onChange={(e) => update(entry.id, { current: e.target.checked })}
              />
              <span>Still studying here</span>
            </label>
          </div>
          {!entry.endDate && (
            <p className="hint" style={{ margin: '8px 0 0' }}>
              {entry.current
                ? 'Add the date you expect to finish — forms ask for it as your expected graduation date.'
                : 'Add an end date so forms asking for a graduation date can be filled.'}
            </p>
          )}
          <button type="button" className="btn btn-danger remove" onClick={() => remove(entry.id)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={add}>
        + Add education entry
      </button>
    </section>
  );
}

export function ProjectsSection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const update = (id: string, patch: Partial<ProjectEntry>) =>
    onChange({
      ...profile,
      projects: profile.projects.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    });

  const add = () =>
    onChange({
      ...profile,
      projects: [
        ...profile.projects,
        { id: crypto.randomUUID(), name: '', role: '', description: '', techStack: '', outcomes: '' },
      ],
    });

  const remove = (id: string) =>
    onChange({ ...profile, projects: profile.projects.filter((entry) => entry.id !== id) });

  return (
    <section>
      <h2>Projects</h2>
      <p className="hint">
        What you built, what you did on it, and how it turned out. This is what the AI uses to draft answers, so
        specifics beat summaries.
      </p>
      {profile.projects.map((entry) => (
        <div className="entry" key={entry.id}>
          <div className="grid">
            <TextField label="Name" value={entry.name} onChange={(v) => update(entry.id, { name: v })} />
            <TextField label="Your role" value={entry.role} onChange={(v) => update(entry.id, { role: v })} />
            <TextField label="Tech stack" value={entry.techStack} onChange={(v) => update(entry.id, { techStack: v })} />
          </div>
          <label className="field">
            <span>Description</span>
            <textarea
              value={entry.description}
              onChange={(e) => update(entry.id, { description: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Outcomes</span>
            <textarea value={entry.outcomes} onChange={(e) => update(entry.id, { outcomes: e.target.value })} />
          </label>
          <button type="button" className="btn btn-danger remove" onClick={() => remove(entry.id)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={add}>
        + Add project
      </button>
    </section>
  );
}

export function WorkAuthSection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const wa = profile.workAuthorization;
  const update = (key: keyof Profile['workAuthorization'], value: string | boolean | null) =>
    onChange({ ...profile, workAuthorization: { ...wa, [key]: value } });

  const boolToString = (v: boolean | null) => (v === null ? '' : v ? 'yes' : 'no');
  const stringToBool = (v: string): boolean | null => (v === '' ? null : v === 'yes');

  return (
    <section>
      <h2>Work authorization / EEO</h2>
      <div className="grid">
        <label className="field">
          <FieldLabel label="Authorized to work in country?" required />
          <select
            value={boolToString(wa.authorizedToWorkInCountry)}
            onChange={(e) => update('authorizedToWorkInCountry', stringToBool(e.target.value))}
          >
            <option value="">Prefer not to say</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="field">
          <span>Requires sponsorship?</span>
          <select
            value={boolToString(wa.requiresSponsorship)}
            onChange={(e) => update('requiresSponsorship', stringToBool(e.target.value))}
          >
            <option value="">Prefer not to say</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <SelectField
          label="Work authorisation status"
          value={wa.status}
          options={WORK_AUTH_STATUS_OPTIONS}
          onChange={(v) => update('status', v)}
        />
        <SelectField
          label="Veteran status"
          value={wa.veteranStatus}
          options={VETERAN_OPTIONS}
          onChange={(v) => update('veteranStatus', v)}
        />
        <SelectField
          label="Disability status"
          value={wa.disabilityStatus}
          options={DISABILITY_OPTIONS}
          onChange={(v) => update('disabilityStatus', v)}
        />
        <SelectField
          label="Race / ethnicity"
          value={wa.race}
          options={RACE_OPTIONS}
          onChange={(v) => update('race', v)}
        />
        <SelectField
          label="Gender"
          value={wa.gender}
          options={GENDER_OPTIONS}
          onChange={(v) => update('gender', v)}
        />
      </div>
    </section>
  );
}

export function LogisticsSection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const lg = profile.logistics;
  const boolToString = (v: boolean | null) => (v === null ? '' : v ? 'yes' : 'no');
  const stringToBool = (v: string): boolean | null => (v === '' ? null : v === 'yes');

  return (
    <section>
      <h2>Logistics</h2>
      <div className="grid">
        <TextField
          label="Available from"
          value={lg.availableFrom}
          onChange={(v) => onChange({ ...profile, logistics: { ...lg, availableFrom: v } })}
        />
        <TextField
          label="Salary expectation"
          value={lg.salaryExpectation}
          onChange={(v) => onChange({ ...profile, logistics: { ...lg, salaryExpectation: v } })}
        />
        <label className="field">
          <span>Willing to relocate?</span>
          <select
            value={boolToString(lg.willingToRelocate)}
            onChange={(e) =>
              onChange({ ...profile, logistics: { ...lg, willingToRelocate: stringToBool(e.target.value) } })
            }
          >
            <option value="">Prefer not to say</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <TextField
          label='"How did you hear about us" answers, in order of preference'
          value={lg.hearAboutUsPreferences.join(', ')}
          onChange={(v) =>
            onChange({
              ...profile,
              logistics: {
                ...lg,
                hearAboutUsPreferences: v
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0),
              },
            })
          }
        />
      </div>
      <p className="hint">
        Comma-separated, most preferred first (e.g. "LinkedIn, Social Media"). The first one present among a
        form's options is used.
      </p>
    </section>
  );
}

export function DocumentsSection() {
  // Chromium-only. Rendering the button on a browser that cannot honour it
  // makes the feature look broken rather than unavailable.
  const supported = supportsDocumentsFolder();
  const [folderName, setFolderName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getDocumentsFolderHandle()
      .then((handle) => setFolderName(handle?.name ?? null))
      .finally(() => setLoaded(true));
  }, []);

  const handleGrant = async () => {
    setError(null);
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      await saveDocumentsFolderHandle(handle);
      setFolderName(handle.name);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError('Could not access that folder.');
      }
    }
  };

  if (!supported) {
    return (
      <section>
        <h2>Documents</h2>
        <p className="hint">
          Linking a documents folder needs the File System Access API, which this browser does not support — it is
          currently Chromium-only (Chrome, Brave, Edge). Everything else works as normal; you will just attach
          resumes and cover letters by hand.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2>Documents</h2>
      <p className="hint">
        Grant access to the folder where your tailored resumes and cover letters are saved (e.g. your Desktop{'/'}
        jobs folder). Name files so they include the company and "resume"/"cv" or "cover letter" (e.g. "Acme Corp
        - Resume.pdf") so the extension can find the right one when it hits a file-upload field.
      </p>
      {loaded && (
        <p>{folderName ? <>Linked folder: <strong>{folderName}</strong></> : 'No folder linked yet.'}</p>
      )}
      <button type="button" className="btn" onClick={handleGrant}>
        {folderName ? 'Change folder' : 'Grant folder access'}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

export function NotionSettingsSection({
  value,
  onChange,
}: {
  value: NotionConfig;
  onChange: (value: NotionConfig) => void;
}) {
  const [databases, setDatabases] = useState<NotionDatabaseOption[] | null>(null);
  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'error'>('idle');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const { token, databaseId, skipped } = value;

  // A "Connected" result describes the exact token/database it was run against,
  // so any edit to either makes it stale. Drop it rather than leave a green pill
  // sitting above a configuration that was never tested.
  const update = (patch: Partial<NotionConfig>) => {
    setTestResult(null);
    onChange({ ...value, ...patch });
  };

  const handleFindDatabases = async () => {
    setSearchState('searching');
    setSearchError(null);
    try {
      const results = await searchDatabases(token);
      setDatabases(results);
      setSearchState('idle');
    } catch (err) {
      setSearchState('error');
      setSearchError(err instanceof Error ? err.message : 'Could not search Notion.');
    }
  };

  if (skipped) {
    return (
      <section>
        <h2>Notion tracker</h2>
        <p className="hint">Skipped — the Log to Notion card stays hidden. Everything else works as normal.</p>
        <button type="button" className="btn" onClick={() => onChange({ ...value, skipped: false })}>
          Set up Notion after all
        </button>
      </section>
    );
  }

  return (
    <section>
      <h2>Notion tracker</h2>
      <p className="hint">Log every application you send to a Notion database. Optional — everything else works without it.</p>
      <ol className="setup-steps">
        <li>
          Open{' '}
          <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">
            Notion integrations
          </a>{' '}
          and press <strong>New integration</strong>. Give it any name.
        </li>
        <li>Copy the secret it shows you, and paste it below.</li>
        <li>
          In Notion, open the database you want to log to, click the <strong>•••</strong> menu at the top right,
          choose <strong>Connections</strong>, and pick the integration you just made.
        </li>
        <li>Press <strong>Find my databases</strong> below and choose it from the list.</li>
      </ol>
      <label className="field">
        <span>Integration token</span>
        <input type="password" value={token} onChange={(e) => update({ token: e.target.value })} />
      </label>
      <button
        type="button"
        className="btn"
        style={{ marginTop: 10 }}
        onClick={handleFindDatabases}
        disabled={!token || searchState === 'searching'}
      >
        {searchState === 'searching' ? 'Searching…' : 'Find my databases'}
      </button>
      {searchState === 'error' && <p className="error">{searchError}</p>}
      {databases && (
        <div className="database-options">
          {databases.length === 0 && (
            <p className="hint">No databases found — make sure you shared one with this integration in Notion.</p>
          )}
          {databases.map((db) => (
            <button
              key={db.id}
              type="button"
              className={`btn database-option ${databaseId === db.id ? 'database-option-selected' : ''}`}
              onClick={() => update({ databaseId: db.id })}
            >
              {db.title}
            </button>
          ))}
        </div>
      )}
      <label className="field" style={{ marginTop: 10 }}>
        <span>Database ID</span>
        <input type="text" value={databaseId} onChange={(e) => update({ databaseId: e.target.value })} />
      </label>
      <button
        type="button"
        className="btn"
        style={{ marginTop: 12 }}
        disabled={testing}
        onClick={async () => {
          setTesting(true);
          try {
            const result = await testConnection({ token, databaseId });
            setTestResult(
              result.ok
                ? { ok: true, message: `Connected to ${result.databaseTitle}.` }
                : { ok: false, message: result.message }
            );
          } catch (err) {
            setTestResult({
              ok: false,
              message: err instanceof Error ? err.message : 'Could not reach Notion.',
            });
          } finally {
            setTesting(false);
          }
        }}
      >
        {testing ? 'Testing…' : 'Test connection'}
      </button>
      {testResult && (
        <p className="status-row" style={{ marginTop: 8 }}>
          <span className={`pill ${testResult.ok ? 'pill-success' : 'pill-danger'}`}>{testResult.message}</span>
        </p>
      )}
      <p className="hint" style={{ marginTop: 16 }}>
        Not using Notion? Skipping clears anything entered here and hides the tracker entirely, so the step never
        sits half-finished.
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => onChange({ token: '', databaseId: '', skipped: true })}
      >
        Skip — I don't use Notion
      </button>
    </section>
  );
}

export function CustomQASection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const update = (id: string, patch: Partial<CustomQAEntry>) =>
    onChange({
      ...profile,
      customQA: profile.customQA.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    });

  const add = () =>
    onChange({
      ...profile,
      customQA: [...profile.customQA, { id: crypto.randomUUID(), question: '', answer: '' }],
    });

  const remove = (id: string) =>
    onChange({ ...profile, customQA: profile.customQA.filter((entry) => entry.id !== id) });

  return (
    <section>
      <h2>Custom Q&amp;A</h2>
      <p className="hint">Saved answers to recurring free-text questions (e.g. "Why do you want to work here?").</p>
      {profile.customQA.map((entry) => (
        <div className="entry" key={entry.id}>
          <label className="field">
            <span>Question</span>
            <input type="text" value={entry.question} onChange={(e) => update(entry.id, { question: e.target.value })} />
          </label>
          <label className="field">
            <span>Answer</span>
            <textarea value={entry.answer} onChange={(e) => update(entry.id, { answer: e.target.value })} />
          </label>
          <button type="button" className="btn btn-danger remove" onClick={() => remove(entry.id)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={add}>
        + Add custom Q&amp;A
      </button>
    </section>
  );
}

export function LlmSettingsSection({
  value,
  onChange,
}: {
  value: LlmSettings;
  onChange: (value: LlmSettings) => void;
}) {
  const llm = value;
  const setLlm = onChange;
  const provider = providerById(llm.provider);
  const [hostGranted, setHostGranted] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Editing any of it invalidates a result that described the old settings.
  const update = (patch: Partial<LlmSettings>) => {
    setTestResult(null);
    setLlm({ ...llm, ...patch });
  };

  // MV3 will not let an extension call an arbitrary host without a grant, and
  // the grant has to be asked for from a click.
  const grantHost = async () => {
    const origin = originPatternFor(llm.baseUrl);
    if (!origin) {
      setHostGranted(false);
      return;
    }
    try {
      setHostGranted(await browser.permissions.request({ origins: [origin] }));
    } catch {
      setHostGranted(false);
    }
  };

  const runTest = async () => {
    if (!llm.backend) return;
    setTesting(true);
    try {
      const { testLlmConnection } = await import('@/lib/llm-client');
      const result = await testLlmConnection(llm, llm.backend);
      setTestResult(
        result.ok ? { ok: true, message: 'The model answered. Drafting is ready.' } : { ok: false, message: result.message }
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <section>
      <h2>AI answer drafting</h2>
      <p className="hint">
        Optional. Drafts answers to open-ended questions using your work history and projects. Drafts are always
        shown to you to edit — nothing is entered automatically.
      </p>
      <label className="field">
        <span>Where should drafting run?</span>
        <select
          value={llm.backend ? llm.provider : ''}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) {
              update({ backend: null });
              return;
            }
            const spec = providerById(id);
            update({
              // `backend` still drives whether drafting is on at all, and which
              // dialect the fallback uses.
              backend: spec.dialect === 'ollama' ? 'ollama' : 'openrouter',
              provider: id,
              baseUrl: spec.baseUrl,
              modelPolicy:
                id === 'openrouter'
                  ? { kind: 'free-pool', minContext: 32_000 }
                  : { kind: 'single', model: spec.defaultModel },
            });
          }}
        >
          <option value="">Off</option>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {llm.backend && provider.note && (
        <p className="hint" style={{ marginTop: 10 }}>
          {provider.note}
        </p>
      )}

      {llm.backend && provider.id === 'custom' && (
        <>
          <label className="field" style={{ marginTop: 10 }}>
            <span>Base URL</span>
            <input
              type="text"
              placeholder="https://api.example.com/v1"
              value={llm.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
            />
          </label>
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={grantHost}>
            {hostGranted === true ? 'Access granted' : 'Allow access to this host'}
          </button>
          {hostGranted === false && (
            <p className="error" style={{ marginTop: 8 }}>
              Without permission for that host, requests to it will fail.
            </p>
          )}
        </>
      )}

      {llm.backend && provider.needsKey && (
        <label className="field" style={{ marginTop: 10 }}>
          <span>API key</span>
          <input
            type="password"
            value={llm.apiKeys[provider.id] ?? ''}
            onChange={(e) => update({ apiKeys: { ...llm.apiKeys, [provider.id]: e.target.value } })}
          />
        </label>
      )}
      {llm.backend && provider.id === 'anthropic' && (
        <>
          <label className="field" style={{ marginTop: 10 }}>
            <span>Workspace ID</span>
            <input
              type="text"
              placeholder="Only needed for an identity-linked key"
              value={llm.anthropicWorkspaceId}
              onChange={(e) => update({ anthropicWorkspaceId: e.target.value })}
            />
          </label>
          <p className="hint">
            Leave empty unless Anthropic asks for it. A key tied to your identity rather than to one workspace
            needs to say which workspace a request is for — find the id in the Console under Settings → Workspaces.
          </p>
        </>
      )}

      {llm.backend && provider.keyUrl && (
        <p className="hint">
          Get a key from{' '}
          <a href={provider.keyUrl} target="_blank" rel="noreferrer">
            {provider.keyUrl.replace(/^https:\/\//, '')}
          </a>
          . It is stored on this computer and sent only to {provider.label}.
        </p>
      )}

      {llm.backend === 'ollama' && (
        <>
          <p className="hint" style={{ marginTop: 12 , marginBottom: 10}}>
            Requires <a href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a> running locally with a
            model pulled. Nothing leaves your computer.
          </p>
          <TextField label="Model" value={llm.ollamaModel} onChange={(v) => update({ ollamaModel: v })} />
        </>
      )}

      {llm.backend === 'openrouter' && provider.id === 'openrouter' && (
        <>
          <p className="hint">
            A small, cheap model is enough here — this is mostly pulling structure out of text and writing a first
            draft you then edit. Models ending in <code>:free</code> cost nothing, but usually come with no
            data-retention guarantee and tight daily limits; since the text sent includes your resume and work
            history, prefer a cheap paid model, or use Ollama to keep everything on your machine.
          </p>
          <ModelPicker policy={llm.modelPolicy} onChange={(modelPolicy) => update({ modelPolicy })} />
        </>
      )}

      {/* Providers that serve their own models take a plain model id; only
          OpenRouter has a public catalogue worth browsing in-app. */}
      {llm.backend && provider.dialect !== "ollama" && provider.id !== "openrouter" && (
        <>
          <TextField
            label="Model"
            value={llm.modelPolicy.kind === "single" ? llm.modelPolicy.model : ""}
            onChange={(v) => update({ modelPolicy: { kind: "single", model: v } })}
          />
          <p className="hint">
            The model id exactly as {provider.label} writes it
            {provider.defaultModel ? `, for example "${provider.defaultModel}"` : ''}.
          </p>
        </>
      )}

      {llm.backend && (
        <>
          <button type="button" className="btn" style={{ marginTop: 12 }} disabled={testing} onClick={runTest}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {testResult && (
            <p className="status-row" style={{ marginTop: 8 }}>
              <span className={`pill ${testResult.ok ? 'pill-success' : 'pill-danger'}`}>
                {testResult.ok ? 'Working' : 'Failed'}
              </span>
            </p>
          )}
          {testResult && !testResult.ok && <p className="error" style={{ marginTop: 8 }}>{testResult.message}</p>}

          <label className="field" style={{ marginTop: 12 }}>
            <span>If that fails, fall back to</span>
            <select
              value={llm.fallbackBackend ?? ''}
              onChange={(e) =>
                setLlm({ ...llm, fallbackBackend: (e.target.value || null) as LlmSettings['fallbackBackend'] })
              }
            >
              <option value="">Nothing — report the failure</option>
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Ollama, if it is running</option>
            </select>
          </label>
          {llm.fallbackBackend === llm.backend ? (
            <p className="hint" style={{ marginTop: 8 }}>
              That is the same as the primary, so it cannot help. Pick the other one, or none.
            </p>
          ) : (
            llm.fallbackBackend && (
              <p className="hint" style={{ marginTop: 8 }}>
                Used when the primary is rate-limited, offline, or slow. Its model and key need filling in too —
                switch the dropdown above to configure it, then switch back.
              </p>
            )
          )}
        </>
      )}
    </section>
  );
}

/**
 * Taught field mappings are otherwise invisible once saved — this makes them
 * reviewable, and undoable when a mapping turns out to be wrong.
 */
export function FieldMappingsSection() {
  const [overrides, setOverrides] = useState<FieldOverrides>({});
  const [loaded, setLoaded] = useState(false);

  const reload = () => getFieldOverrides().then(setOverrides);
  useEffect(() => {
    reload().finally(() => setLoaded(true));
  }, []);

  const forget = async (hostname: string) => {
    await clearFieldOverrides(hostname);
    await reload();
  };

  if (!loaded) return null;
  const hosts = Object.keys(overrides).sort();

  return (
    <section>
      <h2>Learned fields</h2>
      <p className="hint">
        Fields you have told ApplyFlow about on specific sites. It uses these before guessing from labels.
      </p>
      {hosts.length === 0 ? (
        <p className="hint" style={{ marginBottom: 0 }}>
          Nothing learned yet. After filling a page, any field it could not place can be taught from the panel.
        </p>
      ) : (
        hosts.map((host) => (
          <div className="entry" key={host}>
            <strong style={{ fontSize: 13 }}>{host}</strong>
            {Object.entries(overrides[host] ?? {}).map(([signature, path]) => (
              <p key={signature} className="hint" style={{ margin: '6px 0 0' }}>
                {signature} → {path}
              </p>
            ))}
            <button type="button" className="btn btn-danger remove" onClick={() => forget(host)}>
              Forget these
            </button>
          </div>
        ))
      )}
    </section>
  );
}

export function LanguagesSection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const update = (id: string, patch: Partial<LanguageEntry>) =>
    onChange({
      ...profile,
      languages: profile.languages.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    });

  const add = () =>
    onChange({
      ...profile,
      languages: [...profile.languages, { id: crypto.randomUUID(), language: '', level: '' }],
    });

  const remove = (id: string) =>
    onChange({ ...profile, languages: profile.languages.filter((entry) => entry.id !== id) });

  return (
    <section>
      <h2>Languages</h2>
      <p className="hint">
        Forms ask for these on the CEFR scale, so that is what is stored — A1/A2 basic, B1/B2 intermediate,
        C1/C2 advanced or fluent.
      </p>
      {profile.languages.map((entry) => (
        <div className="entry" key={entry.id}>
          <div className="grid">
            <TextField
              label="Language"
              value={entry.language}
              onChange={(v) => update(entry.id, { language: v })}
            />
            <SelectField
              label="Level"
              value={entry.level}
              options={LANGUAGE_LEVELS}
              onChange={(v) => update(entry.id, { level: v })}
            />
          </div>
          <button type="button" className="btn btn-danger remove" onClick={() => remove(entry.id)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={add}>
        + Add language
      </button>
    </section>
  );
}

/**
 * Earlier copies of the profile, kept automatically before anything replaces
 * it wholesale. Without this an unlucky import is final, which is exactly the
 * fear that stops people using the import that saves them the typing.
 */
export function ProfileHistorySection() {
  const [snapshots, setSnapshots] = useState<ProfileSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => void getSnapshots().then(setSnapshots);
  useEffect(load, []);

  const restore = async (takenAt: number) => {
    setBusy(true);
    try {
      const ok = await restoreSnapshot(takenAt);
      setMessage(
        ok
          ? 'Restored. Reopen Setup to see the restored details — the current version was saved first, so this is reversible.'
          : 'That version is no longer available.'
      );
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Earlier versions</h2>
      <p className="hint">
        A copy is kept automatically before a resume or JSON import replaces anything. The five most recent are
        stored, on this computer only.
      </p>

      {snapshots.length === 0 && <p className="hint">No earlier versions yet.</p>}

      <div className="doc-results">
        {snapshots.map((snapshot) => (
          <div className="doc-row" key={snapshot.takenAt}>
            <span className="doc-row-label">
              {new Date(snapshot.takenAt).toLocaleString()} — {snapshot.reason}
            </span>
            <button type="button" className="btn" disabled={busy} onClick={() => void restore(snapshot.takenAt)}>
              Restore
            </button>
          </div>
        ))}
      </div>

      {message && <p className="hint" style={{ marginTop: 10 }}>{message}</p>}
    </section>
  );
}

/**
 * Every application put through the tool, kept locally. Answers "is this
 * helping?", and gives people who skipped Notion a tracker of their own.
 */
export function ApplicationHistorySection() {
  const [entries, setEntries] = useState<ApplicationEntry[]>([]);
  const [confirming, setConfirming] = useState(false);

  const load = () => void getApplications().then(setEntries);
  useEffect(load, []);

  const stats = summarize(entries);

  const exportCsv = () => {
    const blob = new Blob([toCsv(entries)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `applyflow-applications-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <h2>Application history</h2>
      <p className="hint">
        Kept on this computer. Nothing here is sent anywhere — it exists so you can see what you have applied to
        and whether this is saving you anything.
      </p>

      {entries.length === 0 ? (
        <p className="hint">Nothing recorded yet. Fill a page and it will appear here.</p>
      ) : (
        <>
          <p className="status-row" style={{ marginBottom: 12 }}>
            <span className="pill pill-neutral">{stats.total} applications</span>
            <span className="pill pill-neutral">{stats.last30Days} in the last 30 days</span>
            <span className="pill pill-success">{stats.fieldsFilled} fields filled</span>
            <span className="pill pill-success">{stats.questionsDrafted} answers drafted</span>
          </p>

          {stats.troublesomeSites.length > 0 && (
            <p className="hint">
              Forms that rejected a value: {stats.troublesomeSites.map((s) => `${s.hostname} (${s.invalid})`).join(', ')}.
            </p>
          )}

          <div className="doc-results">
            {entries.slice(0, 25).map((entry) => (
              <div className="doc-row" key={entry.id}>
                <span className="doc-row-label" title={entry.url}>
                  {new Date(entry.appliedAt).toLocaleDateString()} — {entry.company || entry.hostname}
                  {entry.title ? `, ${entry.title}` : ''}
                </span>
                <span className="pill pill-neutral">{entry.filledCount} filled</span>
              </div>
            ))}
          </div>

          <div className="setup-footer" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={exportCsv}>
              Export CSV
            </button>
            {confirming ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void clearApplications().then(() => { setConfirming(false); load(); })}
              >
                Really clear history
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirming(true)}>
                Clear history
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
