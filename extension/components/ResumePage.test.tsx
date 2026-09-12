import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResumePage } from './ResumePage';
import type { ResumeDocument } from '@/lib/resume-document';

/**
 * That every line on the page can be typed into.
 *
 * "Not all text is editable" was reported three times across as many rounds of
 * fixes, and each round made one more field editable and left the rest. The
 * list below is the whole document, so the next field added to the page fails
 * here rather than shipping read-only.
 */
const DOCUMENT: ResumeDocument = {
  name: 'Jordan Avery',
  headline: 'AI Engineer · Berlin',
  summary: 'Builds retrieval systems end to end.',
  contactLine: 'me@example.com · Berlin',
  linksLine: 'github.com/example',
  experience: [
    {
      heading: 'Engineer at Revel8',
      meta: '2023 – 2025',
      bullets: ['Shipped a triage agent.'],
      tailored: true,
    },
  ],
  projects: [
    {
      heading: 'Repo Triage Agent',
      meta: 'Python, FastAPI',
      bullets: ['Cut triage time.'],
      link: 'github.com/example/triage',
      tailored: true,
    },
  ],
  education: ['BSc Computer Science'],
  skills: [{ label: 'Languages', items: ['Python', 'TypeScript'] }],
  languages: 'German (B2) · English (fluent)',
  certifications: ['AWS Solutions Architect'],
  omitted: [],
};

const markup = () =>
  renderToStaticMarkup(
    <ResumePage document={DOCUMENT} onEditBullet={() => {}} onEditSection={() => {}} onEditHeading={() => {}} onEdit={() => {}} />
  );

/** Every editable region the page rendered, by the label it announces. */
function editableLabels(html: string): string[] {
  return [...html.matchAll(/contenteditable="plaintext-only"[^>]*aria-label="([^"]+)"/gi)].map((m) => m[1]!);
}

describe('what can be typed into on the resume', () => {
  const labels = editableLabels(markup());

  it.each([
    'Your name',
    'Headline',
    'Contact line',
    'Links line',
    'Summary',
    'Languages',
  ])('%s', (label) => {
    expect(labels).toContain(label);
  });

  it('the title, dates and link of an entry', () => {
    // The last read-only text on the page, and the reason a wrong job title
    // meant saving the file and fixing it in Word.
    expect(labels).toContain('Title of entry 1');
    expect(labels).toContain('Dates or technologies for Engineer at Revel8');
    expect(labels).toContain('Link for Repo Triage Agent');
  });

  it('a section title, so it can be renamed or translated', () => {
    expect(labels).toContain('Experience section title');
    expect(labels).toContain('Skills section title');
  });

  it('both halves of a skills line', () => {
    expect(labels).toContain('Skill group 1 name');
    expect(labels).toContain('Languages skills');
  });

  it('education, certifications and bullets', () => {
    expect(labels).toContain('Education line 1');
    expect(labels).toContain('Certification 1');
    expect(labels).toContain('Bullet 1 under Engineer at Revel8');
  });
});

describe('how the page is built', () => {
  it('never puts a block element inside a paragraph', () => {
    // A <div> inside a <p> is invalid, and the browser repairs it by ending
    // the paragraph early — which is what put every entry's dates on their own
    // line under the title instead of beside it.
    const html = markup();
    expect(html).not.toMatch(/<p[^>]*>(?:(?!<\/p>)[\s\S])*<div/);
  });
});
