import { describe, expect, it } from 'vitest';
import { companyFromUrl } from './company-scraper';

/**
 * The company name decides every saved filename, and the attach step finds
 * documents by scanning names for it. A miss here produced a resume called
 * `Jordan_Avery_Resume.docx` that collided with the previous one.
 */
describe('companyFromUrl', () => {
  it('reads the employer from a Greenhouse board path', () => {
    expect(companyFromUrl('https://boards.greenhouse.io/gitlab/jobs/12345')).toBe('Gitlab');
    expect(companyFromUrl('https://job-boards.greenhouse.io/anthropic/jobs/7')).toBe('Anthropic');
  });

  it('reads the employer from Ashby and Lever paths', () => {
    expect(companyFromUrl('https://jobs.ashbyhq.com/enpal/abc-def')).toBe('Enpal');
    expect(companyFromUrl('https://jobs.lever.co/revel8/uuid')).toBe('Revel8');
  });

  it('reads the tenant from a Personio or Workday subdomain', () => {
    expect(companyFromUrl('https://enpal.jobs.personio.de/job/123')).toBe('Enpal');
    expect(companyFromUrl('https://acme.myworkdayjobs.com/en-US/careers/job/x')).toBe('Acme');
  });

  it('turns a slug into something that reads as a name', () => {
    expect(companyFromUrl('https://jobs.ashbyhq.com/forward-earth/x')).toBe('Forward Earth');
  });

  it('never returns the ATS vendor when the path does not name an employer', () => {
    // "Greenhouse" on every filename would be worse than no company at all.
    expect(companyFromUrl('https://boards.greenhouse.io/')).toBeNull();
  });

  it('reads a company from its own careers page', () => {
    expect(companyFromUrl('https://careers.enpal.de/jobs/1')).toBe('Enpal');
    expect(companyFromUrl('https://jobs.revel8.io/apply')).toBe('Revel8');
    expect(companyFromUrl('https://www.raisin.com/careers/role')).toBe('Raisin');
  });

  it('ignores a numeric slug rather than naming a file after it', () => {
    expect(companyFromUrl('https://boards.greenhouse.io/12345/jobs/1')).toBeNull();
  });

  it('returns null for something that is not a URL', () => {
    expect(companyFromUrl('not a url')).toBeNull();
  });
});
