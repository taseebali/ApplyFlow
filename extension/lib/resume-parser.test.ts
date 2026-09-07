import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LLM_PROMPT_HEADER,
  parseEducationSection,
  parseLlmResponse,
  parseProjectsSection,
  parseResume,
  parseResumeHeuristic,
  splitSections,
} from './resume-parser';
import { bulletsToText } from './schema';

const RESUME = `Jordan Avery
Munich, Germany
jordan.avery2@example.com | +49 30 12345678
linkedin.com/in/jordanavery | github.com/jordanavery | https://jordanavery.dev

EXPERIENCE
Software Engineer, Revel8 — 2023 to present
Built security training simulations.

EDUCATION
BSc Computer Science, TU Munich, 2019-2023

SKILLS
TypeScript, React, Python
`;

describe('splitSections', () => {
  it('keeps contact details in the header and labels the rest', () => {
    const { header, sections } = splitSections(RESUME);
    expect(header).toContain('jordan.avery2@example.com');
    expect(header).not.toContain('Software Engineer');
    expect(sections.workHistory).toContain('Software Engineer');
    expect(sections.education).toContain('TU Munich');
    expect(sections.skills).toContain('TypeScript');
  });

  it('recognizes common header spellings', () => {
    const { sections } = splitSections('Work History\nA\n\nProfessional Experience\nB');
    expect(sections.workHistory).toBeDefined();
  });

  it('does not treat a long prose line as a section header', () => {
    const prose = 'I have experience building education projects and skills in React.';
    const { header, sections } = splitSections(prose);
    expect(header).toBe(prose);
    expect(Object.keys(sections)).toHaveLength(0);
  });
});

describe('parseResumeHeuristic', () => {
  it('extracts contact details and links', () => {
    const parsed = parseResumeHeuristic(RESUME);
    expect(parsed.contact.email).toBe('jordan.avery2@example.com');
    expect(parsed.contact.phone).toBe('+49 30 12345678');
    expect(parsed.links.linkedin).toBe('linkedin.com/in/jordanavery');
    expect(parsed.links.github).toBe('github.com/jordanavery');
    expect(parsed.links.website).toBe('https://jordanavery.dev');
  });

  it('reads the name from the first header line', () => {
    const parsed = parseResumeHeuristic(RESUME);
    expect(parsed.contact.firstName).toBe('Jordan');
    expect(parsed.contact.lastName).toBe('Avery');
  });

  it('falls back to the email local part when there is no name line', () => {
    const parsed = parseResumeHeuristic('jordan.avery@example.com\n\nEXPERIENCE\nEngineer');
    expect(parsed.contact.firstName).toBe('Jordan');
    expect(parsed.contact.lastName).toBe('Avery');
  });

  it('does not mistake a year range or postcode for a phone number', () => {
    const parsed = parseResumeHeuristic('Jane Roe\njane@example.com\n80331 Munich, 2019-2023');
    expect(parsed.contact.phone).toBeUndefined();
  });

  it('does not pick a project link as the personal website', () => {
    const parsed = parseResumeHeuristic(
      'Jane Roe\njane@example.com\n\nPROJECTS\nThing — https://not-my-site.example.com'
    );
    expect(parsed.links.website).toBeUndefined();
  });

  it('returns empty sections rather than throwing on unrecognisable input', () => {
    const parsed = parseResumeHeuristic('');
    expect(parsed.contact).toEqual({});
    expect(parsed.workHistory).toEqual([]);
  });
});

describe('parseLlmResponse', () => {
  const GOOD = JSON.stringify({
    workHistory: [{ company: 'Revel8', title: 'Engineer', current: true, description: 'd' }],
    education: [{ school: 'TU Munich', degree: 'BSc' }],
    projects: [{ name: 'ApplyFlow', techStack: 'TypeScript' }],
  });

  it('reads well-formed JSON into schema-shaped entries with ids', () => {
    const parsed = parseLlmResponse(GOOD);
    expect(parsed.workHistory).toHaveLength(1);
    expect(parsed.workHistory[0]!.company).toBe('Revel8');
    expect(parsed.workHistory[0]!.current).toBe(true);
    expect(parsed.workHistory[0]!.id).toBeTruthy();
    expect(parsed.education[0]!.school).toBe('TU Munich');
    expect(parsed.projects[0]!.name).toBe('ApplyFlow');
  });

  it('recovers JSON wrapped in markdown fences and prose', () => {
    const parsed = parseLlmResponse('Sure! Here you go:\n```json\n' + GOOD + '\n```\nHope that helps.');
    expect(parsed.workHistory[0]!.company).toBe('Revel8');
  });

  it('returns empty arrays rather than throwing on unparsable output', () => {
    expect(parseLlmResponse('I cannot help with that.')).toEqual({
      workHistory: [],
      education: [],
      projects: [],
      certifications: [],
    });
    expect(parseLlmResponse('{ broken json').workHistory).toEqual([]);
  });

  it('drops entries with no identifying content and coerces bad field types', () => {
    const parsed = parseLlmResponse(
      JSON.stringify({
        workHistory: [{ description: 'orphan with no company or title' }, { company: 'Real', title: 42 }],
        projects: [{ role: 'no name' }],
      })
    );
    expect(parsed.workHistory).toHaveLength(1);
    expect(parsed.workHistory[0]!.company).toBe('Real');
    expect(parsed.workHistory[0]!.title).toBe('');
    expect(parsed.projects).toHaveLength(0);
  });

  it('ignores a non-array where an array was expected', () => {
    expect(parseLlmResponse(JSON.stringify({ workHistory: 'nope' })).workHistory).toEqual([]);
  });
});

describe('parseResume', () => {
  const OFF = {
    backend: null,
    fallbackBackend: null,
    ollamaModel: '',
    openRouterApiKey: '',
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeys: { openrouter: 'k' },
    anthropicWorkspaceId: '',
    modelPolicy: { kind: 'single', model: 'm' },
  } as const;

  it('still imports contact details with no AI backend configured', async () => {
    const outcome = await parseResume(RESUME, OFF);
    expect(outcome.ai).toBe('off');
    expect(outcome.parsed.contact.email).toBe('jordan.avery2@example.com');
    expect(outcome.parsed.education).toHaveLength(1);
  });

  it('reports an AI failure instead of silently returning a thin result', async () => {
    const broken = { ...OFF, backend: 'openrouter' as const, openRouterApiKey: 'bad' };
    const outcome = await parseResume(RESUME, broken);
    expect(outcome.ai).toBe('failed');
    expect(outcome.aiError).toBeTruthy();
    // The heuristic result still comes through — a model failure must not
    // throw away everything that was parsed locally.
    expect(outcome.parsed.contact.email).toBe('jordan.avery2@example.com');
  });
});

describe('parseProjectsSection', () => {
  const SECTION = `Real-Time Vision & AI Narration System GitHub
python, pytorch, yolov8, blip, cuda, docker
• Built a real-time pipeline (YOLOv8 chained into BLIP captioning and
text-to-speech) — a full multimodal pipeline, not a single-model demo.
• Packaged with Docker for reproducible setup.
Repo Triage Agent — LLM Agent for Automated Issue Triage GitHub
python, fastapi, anthropic-api
• Built an evaluation harness scoring an agent against 10 verified fixes.`;

  it('separates projects and keeps their tech stacks', () => {
    const projects = parseProjectsSection(SECTION);
    expect(projects).toHaveLength(2);
    expect(projects[0]!.name).toBe('Real-Time Vision & AI Narration System');
    expect(projects[0]!.techStack).toBe('python, pytorch, yolov8, blip, cuda, docker');
    expect(projects[1]!.name).toBe('Repo Triage Agent — LLM Agent for Automated Issue Triage');
  });

  it('treats a wrapped bullet as continuation, not a new project', () => {
    const projects = parseProjectsSection(SECTION);
    // The wrapped line joins the bullet it continues rather than starting one.
    expect(bulletsToText(projects[0]!.bullets)).toContain('text-to-speech)');
    expect(projects.map((p) => p.name)).not.toContain(
      'text-to-speech) — a full multimodal pipeline, not a single-model demo.'
    );
  });

  it('strips trailing anchor words from the project name', () => {
    expect(parseProjectsSection('Some Project GitHub\n• Did a thing.')[0]!.name).toBe('Some Project');
  });
});

describe('parseEducationSection', () => {
  it('splits degree, school, and years without leaving date debris', () => {
    const entries = parseEducationSection(
      'B.Sc. Computer Science April 2024 – Aug 2027 (expected)\nHochschule Berlin 1.6 (German scale)'
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.degree).toBe('B.Sc. Computer Science');
    expect(entries[0]!.school).toBe('Hochschule Berlin');
    expect(entries[0]!.startDate).toBe('2024');
    expect(entries[0]!.endDate).toBe('2027');
  });

  it('handles more than one qualification', () => {
    const entries = parseEducationSection(
      'MSc Robotics 2021 - 2023\nTU Munich\nBachelor of Engineering 2017 - 2021\nNUST College'
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]!.school).toBe('NUST College');
  });
});

// Two real resumes for the same person, formatted completely differently.
// These exist to stop the parser being tuned to one layout at another's cost.
describe('layout independence', () => {
  it('reads a project heading whether tech follows a pipe or sits on its own line', () => {
    const piped = parseProjectsSection(
      'werkstudent.exe - End-to-End Pipeline | Python, Anthropic API, Google Workspace APIs\n• Did the thing.'
    );
    const stacked = parseProjectsSection(
      'Real-Time Vision System GitHub\npython, pytorch, docker\n• Did the thing.'
    );
    expect(piped[0]!.name).toBe('werkstudent.exe - End-to-End Pipeline');
    expect(piped[0]!.techStack).toBe('Python, Anthropic API, Google Workspace APIs');
    expect(stacked[0]!.name).toBe('Real-Time Vision System');
    expect(stacked[0]!.techStack).toBe('python, pytorch, docker');
  });

  it('keeps hyphenated words inside a project name', () => {
    const projects = parseProjectsSection('VERDICT - AutoML Decision-Intelligence Platform\n• Built it.');
    expect(projects[0]!.name).toBe('VERDICT - AutoML Decision-Intelligence Platform');
  });

  it('drops a repo link from the heading instead of putting it in the name', () => {
    const projects = parseProjectsSection('Repo Triage Agent | github.com/jordanavery/repo-triage\n• Built it.');
    expect(projects[0]!.name).toBe('Repo Triage Agent');
  });

  it('splits degree from school whether they share a line or not', () => {
    const oneLine = parseEducationSection(
      'B.Sc. Computer Science - Hochschule Berlin | April 2024 - August 2027 (expected)'
    );
    const twoLines = parseEducationSection(
      'B.Sc. Computer Science April 2024 – Aug 2027 (expected)\nHochschule Berlin 1.6 (German scale)'
    );
    for (const entries of [oneLine, twoLines]) {
      expect(entries).toHaveLength(1);
      expect(entries[0]!.degree).toBe('B.Sc. Computer Science');
      expect(entries[0]!.school).toBe('Hochschule Berlin');
      expect(entries[0]!.startDate).toBe('2024');
      expect(entries[0]!.endDate).toBe('2027');
    }
  });
});

describe('education still-in-progress detection', () => {
  it('marks a course as current when the resume says expected', () => {
    const entries = parseEducationSection(
      'B.Sc. Computer Science - Hochschule Berlin | April 2024 - August 2027 (expected)'
    );
    expect(entries[0]!.current).toBe(true);
    // The expected finish date is what forms ask for as graduation date.
    expect(entries[0]!.endDate).toBe('2027');
  });

  it('leaves a finished course as not current', () => {
    const entries = parseEducationSection('BSc Physics 2015 - 2018\nTU Munich College');
    expect(entries[0]!.current).toBe(false);
  });
});

/**
 * Written from the layout of a real resume: the repository sits on its own
 * line under a project's bullets, and certifications are one line each.
 */
describe('links and certifications, as real resumes print them', () => {
  const RESUME = [
    'RELEVANT EXPERIENCE & PROJECTS',
    "Repo Triage Agent - LLM Agent for Automated Workflow Triage",
    '● Built an autonomous agent using the tool-use protocol that plans and iterates.',
    '● Built an evaluation harness scoring it against 10 real, verified bug fixes.',
    'github.com/jordanavery/repo-triage',
    'VERDICT - AutoML Decision-Intelligence Platform',
    '● Built an end-to-end AutoML pipeline automating preprocessing and training.',
    'github.com/jordanavery/verdict',
    '',
    'CERTIFICATIONS',
    '● Supervised Machine Learning: Regression and Classification - DeepLearning.AI, March 2025',
    '● Database Design - DataCamp, June 2026',
    '● Intermediate SQL - DataCamp, June 2026',
  ].join('\n');

  it('attaches a bare link line to the project above it', () => {
    const projects = parseResumeHeuristic(RESUME).projects;
    expect(projects.map((p) => p.name)).toEqual([
      'Repo Triage Agent - LLM Agent for Automated Workflow Triage',
      'VERDICT - AutoML Decision-Intelligence Platform',
    ]);
    expect(projects[0]!.link).toBe('github.com/jordanavery/repo-triage');
    expect(projects[1]!.link).toBe('github.com/jordanavery/verdict');
  });

  it('does not invent a project named after a URL', () => {
    // The link follows a bullet, so it looked exactly like the next title.
    const names = parseResumeHeuristic(RESUME).projects.map((p) => p.name);
    expect(names.some((name) => name.includes('github.com'))).toBe(false);
  });

  it('reads certifications as name, issuer and date', () => {
    const certs = parseResumeHeuristic(RESUME).certifications;
    expect(certs).toHaveLength(3);
    expect(certs[1]).toMatchObject({ name: 'Database Design', issuer: 'DataCamp', date: 'June 2026' });
  });

  it('keeps a certification that names no issuer', () => {
    const certs = parseResumeHeuristic(
      ['CERTIFICATIONS', '● AWS Certified Cloud Practitioner'].join('\n')
    ).certifications;
    expect(certs).toHaveLength(1);
    expect(certs[0]!.name).toBe('AWS Certified Cloud Practitioner');
  });

  it('takes a link from the heading line when that is where it is', () => {
    const projects = parseResumeHeuristic(
      [
        'PROJECTS',
        'ApplyFlow | TypeScript, React | github.com/jordanavery/applyflow',
        '● Built a job autofiller.',
      ].join('\n')
    ).projects;
    expect(projects[0]!.name).toBe('ApplyFlow');
    expect(projects[0]!.techStack).toBe('TypeScript, React');
    expect(projects[0]!.link).toBe('github.com/jordanavery/applyflow');
  });

  it('asks the model for the link and the certificates', () => {
    expect(LLM_PROMPT_HEADER).toContain('"link"');
    expect(LLM_PROMPT_HEADER).toContain('"certifications"');
    expect(LLM_PROMPT_HEADER).toMatch(/never guess one/i);
  });
});

/**
 * The real thing, not a fixture written to pass.
 *
 * fixtures/real-resume.txt is the resume page of an application actually sent,
 * extracted from its PDF. Three separate faults only showed up here: Word's
 * default bullet glyph was missing from the list, the heading "RELEVANT
 * EXPERIENCE & PROJECTS" matched no section pattern, and a bullet ending in a
 * URL swallowed the next project's title.
 */
describe('a real resume, end to end', () => {
  const TEXT = readFileSync(join(__dirname, '..', 'fixtures', 'real-resume.txt'), 'utf-8');

  it('finds every project, with its link', () => {
    const projects = parseResumeHeuristic(TEXT).projects;
    expect(projects).toHaveLength(3);
    expect(projects.map((p) => p.link)).toEqual([
      'github.com/jordanavery/repo-triage',
      'github.com/jordanavery/verdict',
      'github.com/jordanavery/real-time-vision-system',
    ]);
  });

  it('keeps each project’s bullets with that project', () => {
    const projects = parseResumeHeuristic(TEXT).projects;
    expect(projects.map((p) => p.bullets.length)).toEqual([4, 3, 2]);
  });

  it('never names a project after a URL or a bullet', () => {
    for (const project of parseResumeHeuristic(TEXT).projects) {
      expect(project.name).not.toMatch(/github\.com|^●/);
      expect(project.name.length).toBeLessThan(80);
    }
  });

  it('reads all three certifications', () => {
    const certs = parseResumeHeuristic(TEXT).certifications;
    expect(certs.map((c) => c.issuer)).toEqual(['DeepLearning.AI', 'DataCamp', 'DataCamp']);
  });

  it('reads the contact block', () => {
    const parsed = parseResumeHeuristic(TEXT);
    expect(parsed.contact.email).toBe('jordan.avery@example.com');
    expect(parsed.contact.firstName).toBe('Jordan');
    expect(parsed.links.github).toBe('github.com/jordanavery');
  });
});
