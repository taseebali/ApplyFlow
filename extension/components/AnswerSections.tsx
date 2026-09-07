import { type CustomQAEntry, type Profile } from '@/lib/schema';
import { FieldLabel, TextField, SelectField } from '@/components/fields';
import { TagInput } from './TagInput';

/**
 * The questions every application repeats, and the answers kept to reuse.
 */

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
      </div>

      <div className="field">
        <FieldLabel label="How did you hear about us" />
      </div>
      <TagInput
        label="How did you hear about us, in order of preference"
        value={lg.hearAboutUsPreferences}
        placeholder="LinkedIn, then Enter"
        onChange={(next) => onChange({ ...profile, logistics: { ...lg, hearAboutUsPreferences: next } })}
      />
      {/* The one caption on this screen that earns its place: the ordering is
          not something the control can show, and it decides which answer wins. */}
      <p className="hint">Most preferred first. The first of these a form offers is the one picked.</p>
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
