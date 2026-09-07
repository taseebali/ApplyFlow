import { describe, expect, it } from 'vitest';
import { scrapeJobPostingFrom } from './jd-scraper';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const long = (word: string) => `${word} `.repeat(120);

describe('scrapeJobPostingFrom', () => {
  it('prefers the posting’s own structured data', () => {
    const doc = parse(`
      <script type="application/ld+json">
        ${JSON.stringify({ '@type': 'JobPosting', description: '<p>We build solar.</p>' })}
      </script>
      <main>${long('irrelevant')}</main>
    `);
    expect(scrapeJobPostingFrom(doc)).toBe('We build solar.');
  });

  it('reads a Notion-hosted board, which has neither JSON-LD nor a main element', () => {
    // Notion renders the whole posting into generic divs, so `article` and
    // `main` both come back empty and the panel reported "no job posting here"
    // on a page that plainly had one.
    const doc = parse(`<div class="notion-page-content">${long('agents')}</div>`);
    expect(scrapeJobPostingFrom(doc)).toContain('agents');
  });

  it('falls back to the page itself rather than reporting nothing', () => {
    const doc = parse(`<div class="wrapper"><div>${long('responsibilities')}</div></div>`);
    expect(scrapeJobPostingFrom(doc)).toContain('responsibilities');
  });

  it('never returns the application form as the job description', () => {
    // A form's own labels are the biggest text block on plenty of ATS pages.
    const doc = parse(`<body><form>${long('First name Last name Email')}</form></body>`);
    expect(scrapeJobPostingFrom(doc)).toBeNull();
  });

  it('says nothing when there is nothing worth reading', () => {
    expect(scrapeJobPostingFrom(parse('<main>Apply now</main>'))).toBeNull();
  });
});
