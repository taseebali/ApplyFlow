import type { EducationEntry, ProjectEntry, Profile, WorkHistoryEntry } from './schema';

export interface ParsedResume {
  contact: Partial<Profile['contact']>;
  links: Partial<Profile['links']>;
  workHistory: WorkHistoryEntry[];
  education: EducationEntry[];
  projects: ProjectEntry[];
}

export function emptyParsedResume(): ParsedResume {
  return { contact: {}, links: {}, workHistory: [], education: [], projects: [] };
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+\w/;
// Deliberately conservative: at least 9 digits, so years and postcodes don't match.
const PHONE = /(\+?\d[\d\s().-]{8,}\d)/;
const LINKEDIN = /(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/in\/[\w%-]+/i;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+/i;
const URL = /(?:https?:\/\/)[\w.-]+\.[a-z]{2,}(?:\/[\w./#?=&%-]*)?/gi;

/** Section headers as they appear on real resumes, mapped to the profile area they feed. */
const SECTION_PATTERNS: Array<{ key: keyof ParsedResume | 'skills'; pattern: RegExp }> = [
  { key: 'workHistory', pattern: /^(work\s+)?(experience|employment|work history|professional experience)\b/i },
  { key: 'education', pattern: /^education\b/i },
  { key: 'projects', pattern: /^(projects|personal projects|selected projects)\b/i },
  { key: 'skills', pattern: /^(skills|technical skills|technologies)\b/i },
];

/** A header line is short and matches a known section name — body text rarely is both. */
function sectionKeyForLine(line: string): (keyof ParsedResume | 'skills') | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 40) return null;
  return SECTION_PATTERNS.find((s) => s.pattern.test(trimmed))?.key ?? null;
}

/**
 * Splits a resume into its labelled sections. Anything before the first
 * recognised header is the header block, which is where contact details live.
 */
export function splitSections(text: string): { header: string; sections: Record<string, string> } {
  const lines = text.split('\n');
  const headerLines: string[] = [];
  const sections: Record<string, string[]> = {};

  let current: string | null = null;
  for (const line of lines) {
    const key = sectionKeyForLine(line);
    if (key) {
      current = key;
      sections[current] ??= [];
      continue;
    }
    if (current) sections[current]!.push(line);
    else headerLines.push(line);
  }

  return {
    header: headerLines.join('\n').trim(),
    sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.join('\n').trim()])),
  };
}

function cleanUrl(match: string): string {
  return match.replace(/[),.]+$/, '');
}

/**
 * Regex extraction of the fields that regex is genuinely good at. Runs with no
 * AI configured, so contact details always import even when drafting is off.
 */
export function parseResumeHeuristic(text: string): ParsedResume {
  const result = emptyParsedResume();
  const { header } = splitSections(text);
  // Contact details sit in the header block on essentially every resume;
  // searching the whole document would pick up referees and project links.
  const contactScope = header || text;

  const email = contactScope.match(EMAIL)?.[0];
  if (email) result.contact.email = email;

  const phone = contactScope.match(PHONE)?.[0]?.trim();
  if (phone) result.contact.phone = phone;

  const linkedin = text.match(LINKEDIN)?.[0];
  if (linkedin) result.links.linkedin = cleanUrl(linkedin);

  const github = text.match(GITHUB)?.[0];
  if (github) result.links.github = cleanUrl(github);

  const otherUrl = (contactScope.match(URL) ?? [])
    .map(cleanUrl)
    .find((u) => !LINKEDIN.test(u) && !GITHUB.test(u));
  if (otherUrl) result.links.website = otherUrl;

  const name = guessName(header, email);
  if (name) {
    result.contact.firstName = name.firstName;
    result.contact.lastName = name.lastName;
  }

  return result;
}

/**
 * The name is almost always the first substantial line of the header, above
 * the contact details. Anything containing an @ or a digit is a contact line,
 * not a name.
 */
function guessName(header: string, email: string | undefined): { firstName: string; lastName: string } | null {
  for (const rawLine of header.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.length > 50) continue;
    if (/[@\d]/.test(line) || /https?:\/\//i.test(line)) continue;

    const words = line.split(/\s+/).filter((w) => /^[\p{L}'.-]+$/u.test(w));
    if (words.length < 2 || words.length > 4) continue;

    return { firstName: words[0]!, lastName: words[words.length - 1]! };
  }

  // Fall back to the local part of an email like "jordan.avery@…".
  const localPart = email?.split('@')[0];
  const parts = localPart?.split(/[._-]/).filter((p) => /^\p{L}{2,}$/u.test(p)) ?? [];
  if (parts.length >= 2) {
    const capitalize = (w: string) => w[0]!.toUpperCase() + w.slice(1).toLowerCase();
    return { firstName: capitalize(parts[0]!), lastName: capitalize(parts[parts.length - 1]!) };
  }

  return null;
}
