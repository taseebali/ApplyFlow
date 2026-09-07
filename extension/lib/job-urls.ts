import { PATH_SLUG_HOSTS, SUBDOMAIN_SLUG_HOSTS } from './company-scraper';

/**
 * Whether a URL could be a job application, decided before anything loads.
 *
 * The side panel used to be enabled globally, so opening it on one posting
 * left it open on every tab — YouTube, the model catalogue, a second
 * application — all showing the first tab's state. The panel is per-tab now,
 * and this is what decides which tabs it may open on at all.
 *
 * Deliberately generous. A posting we fail to recognise is a panel the user
 * cannot open, which is worse than a panel that opens somewhere useless: the
 * cost of a false positive is one empty screen, and the cost of a false
 * negative is the feature not working on a real job.
 */

/** Hosts that are an applicant tracking system whatever the path says. */
const ATS_HOSTS = [
  // Deliberately not ATS_NAMES: that list exists to *label* which system a URL
  // came from and includes LinkedIn, which is a job board whose every page
  // would then count — feed included.
  ...PATH_SLUG_HOSTS,
  ...SUBDOMAIN_SLUG_HOSTS,
  'greenhouse.io',
  'ashbyhq.com',
  'lever.co',
  'workable.com',
  'smartrecruiters.com',
  'jobvite.com',
  'icims.com',
  'successfactors.com',
  'taleo.net',
  'eightfold.ai',
  'ripplematch.com',
  'breezy.hr',
  'pinpointhq.com',
];

/**
 * Path and host fragments that mean "this is about a job".
 *
 * Covers the company career pages that are not on an ATS at all —
 * `enpal.de/en/careers/...`, `careers.spotify.com/job/...` — which are a large
 * share of real applications and belong to no vendor list.
 */
const JOB_PATH = /(^|\/)(jobs?|careers?|vacanc(y|ies)|stellen|stellenangebote|position|openings?|apply|application|bewerbung|recruit|hiring|joinus|join-us)(\/|$|-|\?)/i;

/** Subdomains that say it before the path does. */
const JOB_HOST = /^(jobs?|careers?|apply|boards|stellen|recruiting|hiring|talent|work|join)\./i;

export interface JobUrlVerdict {
  /** Whether the panel may open here. */
  ok: boolean;
  /** The site, as the user would name it — for the message when it may not. */
  site: string;
}

/** "boards.greenhouse.io" → "greenhouse.io"; used for the message, not matching. */
function siteName(hostname: string): string {
  const host = hostname.replace(/^www\./i, '');
  const parts = host.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : host;
}

export function jobUrlVerdict(href: string): JobUrlVerdict {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { ok: false, site: 'this page' };
  }

  // A browser page, the store, a local file: nothing to fill and nothing the
  // content script can even reach.
  if (!/^https?:$/.test(url.protocol)) return { ok: false, site: 'this page' };

  const host = url.hostname.toLowerCase();
  const site = siteName(host);

  const onAts = ATS_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
  if (onAts) return { ok: true, site };

  if (JOB_HOST.test(host) || JOB_PATH.test(url.pathname)) return { ok: true, site };

  return { ok: false, site };
}

export const isJobUrl = (href: string): boolean => jobUrlVerdict(href).ok;
