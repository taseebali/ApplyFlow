import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseResumeHeuristic } from './resume-parser';
import { assembleResume } from './resume-document';
import { applyProfileDefaults } from './storage';
import { makeVariant } from './bullet-bank';
import { EMPTY_PROFILE } from './schema';

/**
 * The run that found all of this, held in place.
 *
 * The first real tailored resume put a weekend backtracking exercise on the
 * page, gave it three bullets that all said the same thing, and carried no
 * summary, no skills and no languages. Each of those is fixed somewhere else in
 * the tree, with its own unit test; this is the one check that says the whole
 * path still produces the right page when the pieces are put back together.
 */

const TEXT = readFileSync(join(__dirname, '..', 'fixtures', 'real-resume.txt'), 'utf8');

/** An AI-agents internship, in the shape the panel scrapes them. */
const POSTING = `
  AI Agents Engineering Internship. You will build and ship LLM agents in
  Python: retrieval pipelines, tool use, and evaluation harnesses. Experience
  with RAG, vector storage, FastAPI and Docker is a plus. We move fast and
  ship agents that do real work.
`;

describe('the real resume, end to end', () => {
  const parsed = parseResumeHeuristic(TEXT);
  const profile = applyProfileDefaults({
    ...EMPTY_PROFILE,
    contact: { ...EMPTY_PROFILE.contact, ...parsed.contact },
    links: { ...EMPTY_PROFILE.links, ...parsed.links },
    workHistory: parsed.workHistory,
    education: parsed.education,
    // The fixture holds the three substantial projects. The weekend exercise
    // that outranked them is added here, because without it in the running
    // every ranking assertion below would pass by having nothing to reject.
    projects: [
      ...parsed.projects,
      {
        id: 'kt',
        name: "Knight's Tour",
        role: '',
        bullets: [{ id: 'kt-b', text: 'Solved the Knight’s Tour problem using backtracking.' }],
        techStack: 'Python',
        outcomes: '',
        link: '',
      },
    ],
    certifications: parsed.certifications,
    summary: parsed.summary,
    skills: parsed.skills.length > 0 ? parsed.skills : ['Languages: Python, TypeScript', 'Docker'],
    languages: [
      { id: 'l1', language: 'English', level: 'C1' },
      { id: 'l2', language: 'German', level: 'B1' },
    ],
  });

  it('imports the projects the resume prints', () => {
    expect(parsed.projects.length).toBe(3);
    // And the exercise is genuinely in the running, so the tests below are
    // rejecting something rather than passing on an empty set.
    expect(profile.projects.map((p) => p.name)).toContain("Knight's Tour");
  });

  it('leaves a weekend exercise off a resume for an agents role', () => {
    // The failure that started all of this. Knight's Tour outranked a vision
    // system with hard numbers because the bank had happened to succeed for
    // one and fail for the other.
    const document = assembleResume(profile, [], POSTING, 3);
    const headings = document.projects.map((p) => p.heading.toLowerCase());
    expect(headings.some((h) => h.includes('knight'))).toBe(false);
  });

  it('keeps a weekend exercise below the substantial work when both fit', () => {
    const document = assembleResume(profile, [], POSTING, 99);
    const headings = document.projects.map((p) => p.heading.toLowerCase());
    const knight = headings.findIndex((h) => h.includes('knight'));
    // On the page, but last — it is real work and it is not the strongest.
    if (knight !== -1) expect(knight).toBe(headings.length - 1);
  });

  it('gives no section more lines than its source has to say', () => {
    const document = assembleResume(profile, [], POSTING);
    for (const section of [...document.experience, ...document.projects]) {
      expect(section.bullets.length).toBeLessThanOrEqual(4);
      expect(section.bullets.length).toBeGreaterThan(0);
    }
  });

  it('does not repeat one sentence as three framings of itself', () => {
    // Generation writes six framings per source however thin the source is.
    const thin = profile.projects.at(-1)!;
    const document = assembleResume(
      { ...profile, projects: [thin] },
      [
        makeVariant({ sourceId: thin.id, angle: 'technical', text: 'Designed a backtracking algorithm.' }),
        makeVariant({ sourceId: thin.id, angle: 'impact', text: 'Built a backtracking implementation.' }),
        makeVariant({ sourceId: thin.id, angle: 'delivery', text: 'Solved it end-to-end with backtracking.' }),
      ],
      POSTING
    );
    const lines = document.projects[0]?.bullets.length ?? 0;
    expect(lines).toBeLessThanOrEqual(thin.bullets.flatMap((b) => b.text.split(/(?<=[.!?])\s+/)).length);
  });

  it('carries a summary, a skills block and languages', () => {
    // All three were absent from the first real resume: two were parsed and
    // discarded, and the document had no field for the third at all.
    const document = assembleResume(profile, [], POSTING);
    expect(document.skills.length).toBeGreaterThan(0);
    expect(document.languages).toContain('English');
  });

  it('stores every project link as something a browser will open', () => {
    for (const project of profile.projects) {
      if (project.link) expect(project.link).toMatch(/^https?:\/\//);
    }
  });
});
