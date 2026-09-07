import { LANGUAGE_LEVELS, type CertificationEntry, type EducationEntry, type LanguageEntry, type Profile, type ProjectEntry, type WorkHistoryEntry } from '@/lib/schema';
import { LocationFields } from './LocationFields';
import { BulletsField } from './BulletsField';
import { TextField, SelectField } from '@/components/fields';
import { TagInput } from './TagInput';
import { parseSkillRows, serializeSkillRows, type SkillRow } from '@/lib/skill-groups';

/**
 * Who the candidate is — the sections a resume import fills.
 */

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
          bullets: [],
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
          <BulletsField bullets={entry.bullets} onChange={(bullets) => update(entry.id, { bullets })} />
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
            <p className="hint mt-2">
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
        { id: crypto.randomUUID(), name: '', role: '', bullets: [], techStack: '', outcomes: '', link: '' },
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
            <TextField
              label="Link"
              value={entry.link}
              onChange={(v) => update(entry.id, { link: v })}
            />
            <TextField label="Tech stack" value={entry.techStack} onChange={(v) => update(entry.id, { techStack: v })} />
          </div>
          <BulletsField bullets={entry.bullets} onChange={(bullets) => update(entry.id, { bullets })} />
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

/**
 * The two things a resume needs that no other part of the profile holds.
 *
 * Skills were derived from project tech stacks until a real resume came out
 * with forty terms on it, half of them from projects that had been cut. They
 * are the user's list now, in the user's order.
 *
 * Chips rather than a text field. The text field re-split and trimmed the
 * whole string on every keystroke, so a typed space or comma was eaten
 * immediately and a second skill could not be entered at all — and the hint
 * described a line-based grouping syntax the handler never implemented. A
 * group is now a labelled row, not something to remember how to punctuate.
 */
export function SkillsSection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  // Derived from the profile rather than held beside it: a second copy of the
  // list is a second thing that can go stale, and every edit here writes
  // straight through. An empty profile still shows one row to type into.
  const stored = parseSkillRows(profile.skills);
  const rows = stored.length > 0 ? stored : [{ label: '', items: [] }];
  const setRows = (next: SkillRow[]) => onChange({ ...profile, skills: serializeSkillRows(next) });
  const setRow = (index: number, row: SkillRow) => setRows(rows.map((r, i) => (i === index ? row : r)));

  return (
    <section>
      <h2>Summary, skills and headline</h2>
      <TextField
        label="Headline"
        value={profile.headline}
        onChange={(v) => onChange({ ...profile, headline: v })}
      />
      <p className="hint">One line under your name on a tailored resume, like "AI Engineer · Berlin". Optional.</p>

      <label className="field">
        <span>Summary</span>
        <textarea
          rows={4}
          value={profile.summary}
          placeholder="What you build, in two or three lines. The part a recruiter actually reads."
          onChange={(e) => onChange({ ...profile, summary: e.target.value })}
        />
      </label>
      <p className="hint">
        Sits under your name. Say what you build rather than listing what you have built, and say what you are
        still learning if that is honest.
      </p>

      <fieldset className="skill-rows">
        <legend>Skills</legend>
        {rows.map((row, index) => (
          <div className="skill-row" key={index}>
            <div className="skill-row-head">
              <input
                type="text"
                className="skill-row-label"
                aria-label={`Group name for row ${index + 1}`}
                value={row.label}
                placeholder="Group name, optional"
                onChange={(e) => setRow(index, { ...row, label: e.target.value })}
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  className="btn-plain"
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  Remove group
                </button>
              )}
            </div>
            <TagInput
              label={row.label.trim() ? `${row.label.trim()} skills` : 'Skills'}
              value={row.items}
              placeholder="Python, then Enter"
              onChange={(items) => setRow(index, { ...row, items })}
            />
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setRows([...rows, { label: '', items: [] }])}>
          Add a group
        </button>
      </fieldset>
      <p className="hint">
        Type a skill and press Enter. Groups are optional — one called{' '}
        <span className="mono">Languages</span> or <span className="mono">Tools</span> is what keeps forty terms
        readable on the page. Tailoring moves the ones a posting asks for to the front.
      </p>
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
 * Certificates a resume names.
 *
 * Small, but the reference resume this was measured against carries three of
 * them, and they are the cheapest credibility on the page for someone whose
 * experience is mostly projects.
 */
export function CertificationsSection({
  profile,
  onChange,
}: {
  profile: Profile;
  onChange: (p: Profile) => void;
}) {
  const update = (id: string, patch: Partial<CertificationEntry>) =>
    onChange({
      ...profile,
      certifications: profile.certifications.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry
      ),
    });

  const add = () =>
    onChange({
      ...profile,
      certifications: [
        ...profile.certifications,
        { id: crypto.randomUUID(), name: '', issuer: '', date: '' },
      ],
    });

  const remove = (id: string) =>
    onChange({ ...profile, certifications: profile.certifications.filter((entry) => entry.id !== id) });

  return (
    <section>
      <h2>Certifications</h2>
      <p className="hint">
        Named on a tailored resume under their own heading. Leave this empty and the heading does not appear.
      </p>
      {profile.certifications.map((entry) => (
        <div className="entry" key={entry.id}>
          <div className="grid">
            <TextField label="Name" value={entry.name} onChange={(v) => update(entry.id, { name: v })} />
            <TextField label="Issuer" value={entry.issuer} onChange={(v) => update(entry.id, { issuer: v })} />
            <TextField label="Date" value={entry.date} onChange={(v) => update(entry.id, { date: v })} />
          </div>
          <button type="button" className="btn btn-danger remove" onClick={() => remove(entry.id)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={add}>
        + Add certification
      </button>
    </section>
  );
}
