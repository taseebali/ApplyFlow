/**
 * Working out which company is hiring.
 *
 * This decides the filename of every document the extension saves, and the
 * attach step finds documents by scanning names for the company — so a miss
 * here is not cosmetic. It produced `Jordan_Avery_Resume.docx`, which collided
 * with the previous save and became `Jordan_Avery_Resume (2).docx`.
 *
 * The URL is checked before the page's own markup for the applicant tracking
 * systems, because on those hosts the company is in the path as a stable slug
 * while the title and metadata belong to the ATS vendor.
 */

/** ATS hosts that put the employer's slug in the first path segment. */
const PATH_SLUG_HOSTS = [
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'jobs.ashbyhq.com',
  'jobs.lever.co',
  'apply.workable.com',
  'careers.smartrecruiters.com',
  'jobs.smartrecruiters.com',
];

/** ATS hosts where the employer is the leftmost label of the hostname. */
const SUBDOMAIN_SLUG_HOSTS = [
  'personio.de',
  'jobs.personio.de',
  'myworkdayjobs.com',
  'recruitee.com',
  'teamtailor.com',
  'bamboohr.com',
  'factorialhr.com',
  'softgarden.io',
  'join.com',
];

/**
 * The employer named by a job URL, or null when the host is one we know and it
 * does not say.
 *
 * Returning null rather than guessing matters: falling back to the hostname on
 * `boards.greenhouse.io` would put "Greenhouse" on every filename.
 */
export function companyFromUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (PATH_SLUG_HOSTS.includes(host)) {
    return prettify(segments[0]);
  }

  // join.com and friends namespace the employer under a fixed segment.
  if (host === 'join.com' && segments[0] === 'companies') {
    return prettify(segments[1]);
  }

  const subdomainHost = SUBDOMAIN_SLUG_HOSTS.find(
    (known) => host === known || host.endsWith(`.${known}`)
  );
  if (subdomainHost) {
    const labels = host.slice(0, host.length - subdomainHost.length).split('.').filter(Boolean);
    // The leftmost label is the tenant; anything else is ATS routing.
    return prettify(labels[0]);
  }

  // A company's own careers page: careers.enpal.de, jobs.revel8.io.
  const labels = host.split('.').filter((label) => !GENERIC_LABELS.has(label));
  return prettify(labels.length > 1 ? labels[labels.length - 2] : labels[0]);
}

/** Which applicant tracking system a job URL belongs to, for display. */
const ATS_NAMES: Array<[string, string]> = [
  ['greenhouse.io', 'Greenhouse'],
  ['ashbyhq.com', 'Ashby'],
  ['lever.co', 'Lever'],
  ['personio.de', 'Personio'],
  ['myworkdayjobs.com', 'Workday'],
  ['workable.com', 'Workable'],
  ['smartrecruiters.com', 'SmartRecruiters'],
  ['recruitee.com', 'Recruitee'],
  ['teamtailor.com', 'Teamtailor'],
  ['bamboohr.com', 'BambooHR'],
  ['factorialhr.com', 'Factorial'],
  ['softgarden.io', 'softgarden'],
  ['join.com', 'Join'],
  ['linkedin.com', 'LinkedIn'],
];

/**
 * Naming the ATS is worth a line on screen: it tells the user which form
 * ApplyFlow thinks it is looking at, which is the first thing to check when a
 * fill goes wrong.
 */
export function atsFromUrl(href: string): string | null {
  let host: string;
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return null;
  }
  const found = ATS_NAMES.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
  return found ? found[1] : null;
}

/** Subdomains and suffixes that are never the company's name. */
const GENERIC_LABELS = new Set([
  'careers', 'career', 'jobs', 'job', 'apply', 'hiring', 'recruiting', 'talent',
  'com', 'org', 'net', 'io', 'co', 'de', 'uk', 'eu', 'ai', 'dev', 'app', 'gmbh',
]);

function prettify(slug: string | undefined): string | null {
  if (!slug) return null;
  const words = slug
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words || /^\d+$/.test(words)) return null;
  // Capitalised rather than left lowercase, because it goes straight into a
  // filename and a salutation. The user can correct it either way.
  return words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** Best-effort extraction of the hiring company's name from the current page. */
export function scrapeCompanyName(): string | null {
  // 1. JSON-LD JobPosting structured data (schema.org) — most reliable when present.
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent ?? '');
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const name = item?.hiringOrganization?.name;
        if (typeof name === 'string' && name.trim()) return name.trim();
      }
    } catch {
      // Malformed JSON-LD on the page — ignore and keep trying other sources.
    }
  }

  // 2. The URL. Ahead of the page's own metadata because on an ATS host the
  //    title and og:site_name name the vendor, not the employer.
  const fromUrl = companyFromUrl(location.href);
  if (fromUrl) return fromUrl;

  // 3. Open Graph site name meta tag.
  const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
  if (ogSiteName?.trim()) return ogSiteName.trim();

  // 4. "<Job Title> at <Company>" style page titles.
  const titleMatch = document.title.match(/ at ([^|\-–]+)/i);
  if (titleMatch?.[1]?.trim()) return titleMatch[1].trim();

  return null;
}
