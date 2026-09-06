import { describe, expect, it } from 'vitest';
import { assembleResume, resumeFilename } from './resume-document';
import { makeVariant } from './bullet-bank';
import { EMPTY_PROFILE, type Profile } from './schema';

const profile: Profile = {
  ...EMPTY_PROFILE,
  contact: {
    ...EMPTY_PROFILE.contact,
    firstName: 'Jordan',
    lastName: 'Avery',
    email: 'a@example.com',
    phone: '+49 170',
    city: 'Berlin',
    country: 'Germany',
  },
  links: { ...EMPTY_PROFILE.links, linkedin: 'linkedin.com/in/x', github: 'github.com/x' },
  workHistory: [
    {
      id: 'w1',
      company: 'Revel8',
      title: 'Engineer',
      location: '',
      startDate: '2023',
      endDate: '',
      current: true,
      bullets: [],
    },
    {
      id: 'w2',
      company: 'Older',
      title: 'Intern',
      location: '',
      startDate: '2022',
      endDate: '2023',
      current: false,
      bullets: [],
    },
  ],
  projects: [
    { id: 'p1', name: 'ApplyFlow', role: '', bullets: [], techStack: 'TypeScript, React', outcomes: '' },
    { id: 'p2', name: 'Unused', role: '', bullets: [], techStack: 'Rust', outcomes: '' },
  ],
  education: [
    { id: 'e1', school: 'Hochschule Berlin', degree: 'BSc', fieldOfStudy: 'CS', startDate: '2024', endDate: '2027', current: true },
  ],
};

const v = (sourceId: string, text: string) => makeVariant({ sourceId, angle: 'impact', text });

describe('assembleResume', () => {
  it('includes only the roles that contributed a bullet', () => {
    const resume = assembleResume(profile, [v('w1', 'Cut latency 40%.')]);
    expect(resume.experience.map((s) => s.heading)).toEqual(['Engineer — Revel8']);
  });

  it('keeps the profile’s own order, not the selection order', () => {
    // Chronology belongs to the user; relevance ranking reorders bullets
    // within a role, never the roles themselves.
    const resume = assembleResume(profile, [v('w2', 'Shipped 2 things.'), v('w1', 'Cut latency 40%.')]);
    expect(resume.experience.map((s) => s.heading)).toEqual(['Engineer — Revel8', 'Intern — Older']);
  });

  it('marks a current role as running to the present', () => {
    const resume = assembleResume(profile, [v('w1', 'Cut latency 40%.')]);
    expect(resume.experience[0]!.meta).toBe('2023 – present');
  });

  it('groups several bullets under the role they belong to', () => {
    const resume = assembleResume(profile, [v('w1', 'Cut latency 40%.'), v('w1', 'Shipped 3 services.')]);
    expect(resume.experience[0]!.bullets).toHaveLength(2);
  });

  it('carries a project’s technologies as its meta line', () => {
    const resume = assembleResume(profile, [v('p1', 'Built an autofiller.')]);
    expect(resume.projects[0]!.meta).toBe('TypeScript, React');
  });

  it('leaves out a project nothing was selected from', () => {
    const resume = assembleResume(profile, [v('p1', 'Built an autofiller.')]);
    expect(resume.projects.map((p) => p.heading)).toEqual(['ApplyFlow']);
  });

  it('builds the contact and links lines from the profile', () => {
    const resume = assembleResume(profile, []);
    expect(resume.name).toBe('Jordan Avery');
    expect(resume.contactLine).toContain('a@example.com');
    expect(resume.contactLine).toContain('Berlin, Germany');
    expect(resume.linksLine).toContain('github.com/x');
  });

  it('collects technologies across every project, deduplicated', () => {
    const resume = assembleResume(profile, []);
    expect(resume.skills).toBe('TypeScript, React, Rust');
  });

  it('shows an expected graduation date for a course still running', () => {
    expect(assembleResume(profile, []).education[0]).toContain('2027 expected');
  });

  it('produces an empty document rather than throwing for an empty profile', () => {
    const resume = assembleResume(EMPTY_PROFILE, []);
    expect(resume.experience).toEqual([]);
    expect(resume.name).toBe('');
  });
});

describe('assembleResume when the bank is incomplete', () => {
  // The failure that produced a one-project resume from a full profile: one
  // failed generation call left a source with no variants, and the whole job
  // silently vanished from the document.
  const written: Profile = {
    ...profile,
    workHistory: profile.workHistory.map((role) => ({
      ...role,
      bullets: [{ id: `${role.id}-b`, text: `What I did at ${role.company}.` }],
    })),
    projects: profile.projects.map((project) => ({
      ...project,
      bullets: [{ id: `${project.id}-b`, text: `What ${project.name} does.` }],
    })),
  };

  it('keeps a role the bank has nothing for, using the user’s own words', () => {
    const resume = assembleResume(written, [v('w1', 'Cut latency 40%.')]);
    expect(resume.experience.map((s) => s.heading)).toEqual(['Engineer — Revel8', 'Intern — Older']);
    expect(resume.experience[1]!.bullets).toEqual(['What I did at Older.']);
  });

  it('keeps a project the bank has nothing for', () => {
    const resume = assembleResume(written, [v('p1', 'Built an autofiller.')]);
    expect(resume.projects.map((s) => s.heading)).toEqual(['ApplyFlow', 'Unused']);
  });

  it('loses nothing at all when the bank is completely empty', () => {
    const resume = assembleResume(written, []);
    expect(resume.experience).toHaveLength(2);
    expect(resume.projects).toHaveLength(2);
  });

  it('says which sections were tailored and which fell back', () => {
    // The review screen needs this to be honest about what it produced.
    const resume = assembleResume(written, [v('w1', 'Cut latency 40%.')]);
    expect(resume.experience.map((s) => s.tailored)).toEqual([true, false]);
  });

  it('still drops a section with no bullets and no variants', () => {
    // Nothing written and nothing generated means there is nothing to say.
    expect(assembleResume(profile, []).experience).toEqual([]);
  });
});

describe('resumeFilename', () => {
  const resume = assembleResume(profile, []);

  it('names the person and the company', () => {
    expect(resumeFilename(resume, 'Enpal')).toBe('Jordan_Avery_Resume_Enpal.docx');
  });

  it('strips characters a filesystem would refuse', () => {
    expect(resumeFilename(resume, 'Foo/Bar: Inc.')).toBe('Jordan_Avery_Resume_FooBar_Inc.docx');
  });

  it('still produces a filename with no company', () => {
    expect(resumeFilename(resume, '')).toBe('Jordan_Avery_Resume.docx');
  });

  it('falls back to a generic name when the profile has none', () => {
    expect(resumeFilename(assembleResume(EMPTY_PROFILE, []), 'Acme')).toBe('Resume_Acme.docx');
  });
});
