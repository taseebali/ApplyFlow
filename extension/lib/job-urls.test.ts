import { describe, expect, it } from 'vitest';
import { isJobUrl, jobUrlVerdict } from './job-urls';

describe('where the panel may open', () => {
  it('opens on the applicant tracking systems people actually apply through', () => {
    for (const url of [
      'https://boards.greenhouse.io/enpal/jobs/4123456',
      'https://job-boards.greenhouse.io/gitlab/jobs/7788',
      'https://jobs.ashbyhq.com/openai/1a2b3c',
      'https://jobs.lever.co/figma/abc-def',
      'https://enpal.jobs.personio.de/job/1234567',
      'https://acme.myworkdayjobs.com/en-US/careers/job/Berlin/Engineer_R-1',
      'https://apply.workable.com/acme/j/ABC123/',
    ]) {
      expect(isJobUrl(url), url).toBe(true);
    }
  });

  it('opens on a company career page that belongs to no vendor', () => {
    // A large share of real applications, and on no ATS host list anywhere.
    for (const url of [
      'https://www.enpal.de/en/careers/ai-engineering-intern',
      'https://careers.spotify.com/job/12345/',
      'https://monzo.com/careers/backend-engineer',
      'https://www.siemens.de/stellenangebote/12345',
      'https://jobs.example.org/apply/9',
    ]) {
      expect(isJobUrl(url), url).toBe(true);
    }
  });

  it('stays shut on everything else', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=abc',
      'https://claude.ai/chat/123',
      'https://openrouter.ai/settings/keys',
      'https://www.instagram.com/',
      'https://news.ycombinator.com/item?id=1',
      'https://mail.google.com/mail/u/0/#inbox',
    ]) {
      expect(isJobUrl(url), url).toBe(false);
    }
  });

  it('opens on a job board’s posting but not on its feed', () => {
    // LinkedIn Easy Apply is a real application form, so the posting counts.
    // The feed is not, and blanket-allowing linkedin.com would include it.
    expect(isJobUrl('https://www.linkedin.com/jobs/view/4123456')).toBe(true);
    expect(isJobUrl('https://de.indeed.com/jobs?q=engineer')).toBe(true);
    expect(isJobUrl('https://www.linkedin.com/feed/')).toBe(false);
    expect(isJobUrl('https://www.linkedin.com/in/jordanavery')).toBe(false);
  });

  it('stays shut on a browser page, where nothing can run anyway', () => {
    expect(isJobUrl('chrome://extensions')).toBe(false);
    expect(isJobUrl('brave://settings')).toBe(false);
    expect(isJobUrl('file:///C:/resume.pdf')).toBe(false);
    expect(isJobUrl('not a url at all')).toBe(false);
  });

  it('names the site the way the user would, for the message', () => {
    expect(jobUrlVerdict('https://www.youtube.com/watch?v=1').site).toBe('youtube.com');
    expect(jobUrlVerdict('https://mail.google.com/').site).toBe('google.com');
    expect(jobUrlVerdict('chrome://extensions').site).toBe('this page');
  });
});
