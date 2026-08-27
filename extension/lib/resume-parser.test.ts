import { describe, expect, it } from 'vitest';
import { parseResumeHeuristic, splitSections } from './resume-parser';

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
