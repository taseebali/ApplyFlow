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
    { id: 'p1', name: 'ApplyFlow', role: '', bullets: [], techStack: 'TypeScript, React', outcomes: '', link: '' },
    { id: 'p2', name: 'Unused', role: '', bullets: [], techStack: 'Rust', outcomes: '' , link: ''},
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

  it('uses the skills the user listed, not every technology on every project', () => {
    // Deriving from project tech stacks put 40 terms on a real resume,
    // including projects that had been cut from it.
    const withSkills = { ...profile, skills: ['Python', 'FastAPI', 'Docker'] };
    expect(assembleResume(withSkills, []).skills).toEqual([
      { items: ['Python', 'FastAPI', 'Docker'] },
    ]);
  });

  it('leads with the skills the posting asks for', () => {
    const withSkills = { ...profile, skills: ['Rust', 'Python', 'Docker'] };
    const resume = assembleResume(withSkills, [], 'We need strong Python and Docker experience.');
    expect(resume.skills[0]!.items).toEqual(['Python', 'Docker', 'Rust']);
  });

  it('keeps the user’s own skill order when there is no posting', () => {
    const withSkills = { ...profile, skills: ['Rust', 'Python'] };
    expect(assembleResume(withSkills, []).skills[0]!.items).toEqual(['Rust', 'Python']);
  });

  it('reads "Label: a, b" as a group, which is what keeps forty terms legible', () => {
    const withSkills = {
      ...profile,
      skills: ['Languages: Python, SQL', 'Technical: Docker, Git'],
    };
    expect(assembleResume(withSkills, []).skills).toEqual([
      { label: 'Languages', items: ['Python', 'SQL'] },
      { label: 'Technical', items: ['Docker', 'Git'] },
    ]);
  });

  it('carries a project link, which is what a technical reader clicks first', () => {
    const linked: Profile = {
      ...profile,
      projects: [
        {
          id: 'p1',
          name: 'Agent',
          role: '',
          bullets: [{ id: 'b', text: 'Cut triage time 40%.' }],
          techStack: '',
          outcomes: '',
          link: 'github.com/jordanavery/repo-triage',
        },
      ],
    };
    expect(assembleResume(linked, []).projects[0]!.link).toBe('github.com/jordanavery/repo-triage');
  });

  it('lists certifications as one line each', () => {
    const certified: Profile = {
      ...profile,
      certifications: [
        { id: 'c1', name: 'Intermediate SQL', issuer: 'DataCamp', date: 'June 2026' },
      ],
    };
    expect(assembleResume(certified, []).certifications).toEqual([
      'Intermediate SQL, DataCamp, June 2026',
    ]);
  });

  it('leaves out a certification with nothing in it', () => {
    const blank: Profile = {
      ...profile,
      certifications: [{ id: 'c1', name: '', issuer: '', date: '' }],
    };
    expect(assembleResume(blank, []).certifications).toEqual([]);
  });

  it('carries a summary through to the document', () => {
    const withSummary = { ...profile, summary: 'Builds agent systems, not prompt demos.' };
    expect(assembleResume(withSummary, []).summary).toBe('Builds agent systems, not prompt demos.');
  });

  it('carries a headline when the profile has one', () => {
    expect(assembleResume({ ...profile, headline: 'AI Engineer' }, []).headline).toBe('AI Engineer');
  });

  it('shows an expected graduation date for a course still running', () => {
    expect(assembleResume(profile, []).education[0]).toContain('2027 expected');
  });

  it('joins a degree and its field of study', () => {
    expect(assembleResume(profile, []).education[0]).toContain('BSc in CS');
  });

  it('does not repeat a field of study the degree already names', () => {
    // "B.Sc. Computer Science in Computer Science" shipped on a real resume.
    const dup: Profile = {
      ...profile,
      education: [
        {
          ...profile.education[0]!,
          degree: 'B.Sc. Computer Science',
          fieldOfStudy: 'Computer Science',
        },
      ],
    };
    expect(assembleResume(dup, []).education[0]).toContain('B.Sc. Computer Science, Hochschule Berlin');
    expect(assembleResume(dup, []).education[0]).not.toContain('in Computer Science');
  });

  it('handles a degree with no field of study', () => {
    const noField: Profile = {
      ...profile,
      education: [{ ...profile.education[0]!, degree: 'BSc', fieldOfStudy: '' }],
    };
    expect(assembleResume(noField, []).education[0]).toContain('BSc, Hochschule Berlin');
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

  it('caps how many projects reach the page, and says which were left off', () => {
    // Eleven projects rendered as eleven paragraphs is what came out when the
    // bank was empty and nothing trimmed the list.
    const many: Profile = {
      ...profile,
      projects: Array.from({ length: 9 }, (_, i) => ({
        id: `p${i}`,
        name: `Project ${i}`,
        role: '',
        bullets: [{ id: `b${i}`, text: `Built project ${i} and shipped it.` }],
        techStack: 'Python',
        outcomes: '',
        link: '',
      })),
    };
    const resume = assembleResume(many, []);
    expect(resume.projects).toHaveLength(4);
    expect(resume.omitted).toHaveLength(5);
  });

  it('splits an imported paragraph into bullets rather than printing the blob', () => {
    // Resume import stores one blob per project. Printing it whole is how the
    // resume became a wall of prose.
    const blob =
      'Built an autonomous agent on the tool-use protocol that plans and iterates. ' +
      'Exposed it through a FastAPI backend returning a structured triage report. ' +
      'Built an evaluation harness scoring it against real verified bug fixes. ' +
      'Containerised the whole thing with Docker for one-command deployment.';
    const wall: Profile = {
      ...profile,
      projects: [
        { id: 'p1', name: 'Agent', role: '', bullets: [{ id: 'b', text: blob }], techStack: '', outcomes: '' , link: ''},
      ],
    };
    const bullets = assembleResume(wall, []).projects[0]!.bullets;
    expect(bullets.length).toBeGreaterThan(1);
    expect(bullets.every((line) => line.length < 200)).toBe(true);
  });

  it('leaves a short written bullet alone', () => {
    const short: Profile = {
      ...profile,
      projects: [
        { id: 'p1', name: 'X', role: '', bullets: [{ id: 'b', text: 'Cut latency 40%.' }], techStack: '', outcomes: '' , link: ''},
      ],
    };
    expect(assembleResume(short, []).projects[0]!.bullets).toEqual(['Cut latency 40%.']);
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

describe('what earns a place on the page', () => {
  const withSource = (id: string, name: string, text: string, tech = '') => ({
    id,
    name,
    role: '',
    bullets: [{ id: `${id}-b`, text }],
    techStack: tech,
    outcomes: '',
    link: '',
  });

  // The resume that came out of the first real run: a weekend backtracking
  // exercise made the page while a vision system with hard numbers was cut,
  // because the bank had happened to succeed for one and fail for the other.
  const knight = withSource('kt', "Knight's Tour", 'Solved the Knight’s Tour with backtracking.');
  const vision = withSource(
    'rtv',
    'Real-Time Vision',
    'Built a vision and narration pipeline running at 8-9 FPS in 0.7 GB. Ran YOLOv8 and BLIP together on one GPU. Cut inference latency by half.',
    'Python, PyTorch, YOLOv8'
  );

  const POSTING = 'We need someone to build AI agents in Python. PyTorch and vision experience a plus.';

  it('keeps the substantial project when only the thin one is tailored', () => {
    const resume = assembleResume(
      { ...profile, projects: [knight, vision] },
      [v('kt', 'Shipped a working backtracking solver.')],
      POSTING,
      1
    );
    expect(resume.projects.map((p) => p.heading)).toEqual(['Real-Time Vision']);
  });

  it('gives a one-sentence project one line, not three angles on it', () => {
    // Generation writes six framings per source however thin the source is,
    // and selection took three of them: "Designed a backtracking algorithm",
    // "Built a backtracking implementation", "Solved it end-to-end".
    const resume = assembleResume({ ...profile, projects: [knight] }, [
      v('kt', 'Designed a backtracking algorithm for the tour.'),
      v('kt', 'Built a backtracking implementation of the tour.'),
      v('kt', 'Solved the tour end-to-end using backtracking.'),
    ]);
    expect(resume.projects[0]!.bullets).toHaveLength(1);
  });

  it('uses the same cap whether the bank ran or not', () => {
    const tailored = assembleResume({ ...profile, projects: [vision] }, [
      v('rtv', 'One.'),
      v('rtv', 'Two.'),
      v('rtv', 'Three.'),
      v('rtv', 'Four.'),
      v('rtv', 'Five.'),
    ]);
    const fallback = assembleResume({ ...profile, projects: [vision] }, []);
    expect(tailored.projects[0]!.bullets).toHaveLength(fallback.projects[0]!.bullets.length);
  });

  it('puts languages on the document, which had no field for them at all', () => {
    const resume = assembleResume(
      { ...profile, languages: [{ id: 'l1', language: 'German', level: 'B2' }, { id: 'l2', language: 'English', level: 'C2' }] },
      []
    );
    expect(resume.languages).toBe('German (B2)  ·  English (C2)');
  });
});
