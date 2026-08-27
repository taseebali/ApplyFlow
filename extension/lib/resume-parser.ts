import type { EducationEntry, ProjectEntry, Profile, WorkHistoryEntry } from './schema';
import { runPrompt } from './llm-client';
import type { LlmSettings } from './settings';

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

type SectionKey = keyof ParsedResume | 'skills' | 'other';

/** Section headers as they appear on real resumes, mapped to the profile area they feed. */
const SECTION_PATTERNS: Array<{ key: SectionKey; pattern: RegExp }> = [
  { key: 'workHistory', pattern: /^(work\s+)?(experience|employment|work history|professional experience)\b/i },
  { key: 'education', pattern: /^education\b/i },
  { key: 'projects', pattern: /^(projects|personal projects|selected projects)\b/i },
  { key: 'skills', pattern: /^(core skills|skills|technical skills|technologies)\b/i },
  // Not imported, but recognising them keeps their prose out of the header
  // block, which is the scope contact details are searched in.
  { key: 'other', pattern: /^(summary|profile|objective|about me)\b/i },
  { key: 'other', pattern: /^(certifications?|awards|publications|languages|interests|references)\b/i },
];

/** A header line is short and matches a known section name — body text rarely is both. */
function sectionKeyForLine(line: string): SectionKey | null {
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

  const { sections } = splitSections(text);
  if (sections.projects) result.projects = parseProjectsSection(sections.projects);
  if (sections.education) result.education = parseEducationSection(sections.education);

  return result;
}

const BULLET = /^\s*[•·▪◦*-]\s+/;

function isBullet(line: string): boolean {
  return BULLET.test(line);
}

/** A comma-separated run of short tokens is a tech list, not prose. */
function isTechList(line: string): boolean {
  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 2) return false;
  return parts.every((p) => p.length > 0 && p.length < 30 && !/[.!?]$/.test(p));
}

function isUrlish(text: string): boolean {
  return /(https?:\/\/|\b[\w-]+\.(com|org|net|io|dev|ai|co|me)\b)/i.test(text);
}

/**
 * True only when a segment is essentially nothing but a date. Checking that
 * the leftovers are merely short is not enough — "MSc Robotics 2021" would
 * qualify and the degree would be discarded as a date.
 */
function isDateish(text: string): boolean {
  if (!DATE_START.test(text)) return false;
  const withoutDates = text
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?/gi, '')
    .replace(/\b(present|current|ongoing|expected|to|until|since)\b/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return withoutDates.length <= 2;
}

/**
 * Splits a heading on the separators resumes actually use, so each piece can
 * be judged on what it contains rather than where it sits. Line *position*
 * is the thing that differs most between resume layouts; content does not.
 */
function headingSegments(line: string, splitOnDash = false): string[] {
  // A spaced dash separates fields in an education line ("Degree - School"),
  // but in a project title it is part of the name ("werkstudent.exe - Pipeline",
  // "Repo Triage Agent — LLM Agent"), so only education opts into it.
  const pattern = splitOnDash ? /\s*[|•·]\s*|\s+[–—-]\s+/ : /\s*[|•·]\s*/;
  return line
    .split(pattern)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A project heading packs several things onto one line, in an order that
 * varies by resume: the name, sometimes a technology list, sometimes a repo
 * link, sometimes dates. Each piece is identified by what it looks like, so
 * the same code reads "Name | Python, Docker" and "Name GitHub" alike.
 */
export function parseProjectHeading(line: string): Omit<ProjectEntry, 'id'> {
  const entry = { name: '', role: '', description: '', techStack: '', outcomes: '' };

  for (const segment of headingSegments(line)) {
    if (!entry.techStack && isTechList(segment) && !isUrlish(segment)) entry.techStack = segment;
    else if (isUrlish(segment) || isDateish(segment)) continue;
    else if (!entry.name) entry.name = segment;
  }

  if (!entry.name) entry.name = headingSegments(line)[0] ?? line.trim();
  // Trailing anchor words like "GitHub" are link text, not part of the name.
  entry.name = entry.name.replace(/\s*(github|gitlab|demo|live|repo|link|website)\s*$/i, '').trim();
  return entry;
}

/**
 * Projects are written as a heading, optionally a technology line, then
 * bullets describing the work. A new heading is a non-bullet line following
 * bullet text, which is what separates one project from the next.
 */
export function parseProjectsSection(section: string): ProjectEntry[] {
  const projects: ProjectEntry[] = [];
  let current: ProjectEntry | null = null;
  let sawBullet = false;

  const push = () => {
    if (current?.name) projects.push(current);
  };

  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (isBullet(line)) {
      sawBullet = true;
      if (current) {
        const text = line.replace(BULLET, '').trim();
        current.description = current.description ? `${current.description}\n${text}` : text;
      }
      continue;
    }

    // A bullet that wraps onto a second line looks exactly like a new title
    // apart from one thing: the line it continues did not finish its sentence.
    if (current && sawBullet && current.description && !/[.!?]\s*$/.test(current.description)) {
      current.description = `${current.description} ${line}`.trim();
      continue;
    }

    if (!current || sawBullet) {
      push();
      current = { id: crypto.randomUUID(), ...parseProjectHeading(line) };
      sawBullet = false;
      continue;
    }

    if (!current.techStack && isTechList(line)) current.techStack = line;
    else current.name = `${current.name} ${line}`.trim();
  }

  push();
  return projects;
}

const DEGREE = /\b(b\.?\s?sc|m\.?\s?sc|b\.?\s?a|m\.?\s?a|b\.?\s?eng|bachelor|master|ph\.?d|diploma|abitur)\b/i;
const SCHOOL = /\b(university|universit(y|ät|e)|college|school|institute|hochschule|academy)\b/i;
const YEAR = /\b(19|20)\d{2}\b/g;
/** Where the date part of a degree line starts: a month name, a year, or an open-ended marker. */
const DATE_START =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{0,4}|\b(19|20)\d{2}\b|\b(present|current|ongoing|expected)\b/i;
/** A trailing grade such as "1.6 (German scale)" or "GPA 3.8". */
const TRAILING_GRADE = /\s*(gpa\s*:?\s*)?\d[.,]\d+\s*(\([^)]*\))?\s*$/i;

/** Cuts a heading at the point its date range begins, rather than deleting date
 * tokens in place, which leaves debris like "April  – Aug (expected)". */
function stripDates(text: string): string {
  const at = text.search(DATE_START);
  return (at > 0 ? text.slice(0, at) : text).replace(/[,|–—-]\s*$/, '').trim();
}

/**
 * Education entries pair a degree line with a school line, in either order.
 * Dates are pulled off the degree line rather than parsed strictly, since
 * every resume formats them differently.
 */
export function parseEducationSection(section: string): EducationEntry[] {
  const lines = section
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !isBullet(l));

  const entries: EducationEntry[] = [];
  let current: EducationEntry | null = null;

  const blank = (): EducationEntry => ({
    id: crypto.randomUUID(),
    school: '',
    degree: '',
    fieldOfStudy: '',
    startDate: '',
    endDate: '',
  });

  for (const line of lines) {
    const hasDegree = DEGREE.test(line);
    const hasSchool = SCHOOL.test(line);
    if (!hasDegree && !hasSchool) continue;

    // A new qualification starts whenever a degree appears and the entry in
    // hand already has one — true whether the resume puts degree and school
    // on one line or on two.
    if (hasDegree && current?.degree) {
      entries.push(current);
      current = null;
    }
    current ??= blank();

    const years = line.match(YEAR) ?? [];
    if (years.length && !current.startDate) {
      current.startDate = years[0]!;
      // Prefer a real end year over words like "expected", which say when
      // something finishes but not in what year.
      if (years.length > 1) current.endDate = years[years.length - 1]!;
    }

    // Judge each piece by what it contains. "B.Sc. CS - Hochschule Berlin | 2024"
    // and a two-line degree/school pair both land in the right fields.
    for (const segment of headingSegments(line, true)) {
      const clean = segment.replace(TRAILING_GRADE, '').replace(/[,–—-]\s*$/, '').trim();
      if (!clean || isDateish(clean)) continue;
      if (DEGREE.test(clean) && !current.degree) current.degree = stripDates(clean);
      else if (SCHOOL.test(clean) && !current.school) current.school = stripDates(clean);
    }
  }

  if (current?.degree || current?.school) entries.push(current);
  return entries;
}

/** Title-cases a word that is entirely upper case, leaving mixed case alone. */
function fixCaps(word: string): string {
  if (word !== word.toUpperCase()) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
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

    // Resume headers are often set in caps ("JORDAN AVERY"), which is styling,
    // not how the name should be typed into an application form.
    return { firstName: fixCaps(words[0]!), lastName: fixCaps(words[words.length - 1]!) };
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

const LLM_PROMPT_HEADER = [
  'Extract structured data from the resume below.',
  'Return ONLY a JSON object, with no prose, no explanation, and no markdown fences.',
  'Use this exact shape, omitting any array you cannot fill:',
  '{"workHistory":[{"company":"","title":"","location":"","startDate":"","endDate":"","current":false,"description":""}],',
  '"education":[{"school":"","degree":"","fieldOfStudy":"","startDate":"","endDate":""}],',
  '"projects":[{"name":"","role":"","description":"","techStack":"","outcomes":""}]}',
  'Copy facts from the resume only — never invent employers, dates, or metrics.',
  'Leave a field as an empty string if the resume does not state it.',
  '',
  'RESUME:',
].join('\n');

/** Models often wrap JSON in prose or ```json fences despite being told not to. */
function extractJsonObject(raw: string): unknown {
  const withoutFences = raw.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    return null;
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function entriesOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object');
}

/** Builds schema-shaped entries, dropping anything with no identifying content. */
function toWorkHistory(value: unknown): WorkHistoryEntry[] {
  return entriesOf(value)
    .map((e) => ({
      id: crypto.randomUUID(),
      company: str(e.company),
      title: str(e.title),
      location: str(e.location),
      startDate: str(e.startDate),
      endDate: str(e.endDate),
      current: e.current === true,
      description: str(e.description),
    }))
    .filter((e) => e.company || e.title);
}

function toEducation(value: unknown): EducationEntry[] {
  return entriesOf(value)
    .map((e) => ({
      id: crypto.randomUUID(),
      school: str(e.school),
      degree: str(e.degree),
      fieldOfStudy: str(e.fieldOfStudy),
      startDate: str(e.startDate),
      endDate: str(e.endDate),
    }))
    .filter((e) => e.school || e.degree);
}

function toProjects(value: unknown): ProjectEntry[] {
  return entriesOf(value)
    .map((e) => ({
      id: crypto.randomUUID(),
      name: str(e.name),
      role: str(e.role),
      description: str(e.description),
      techStack: str(e.techStack),
      outcomes: str(e.outcomes),
    }))
    .filter((e) => e.name);
}

/** Turns a raw model response into schema-shaped entries. Exported for testing. */
export function parseLlmResponse(raw: string): Pick<ParsedResume, 'workHistory' | 'education' | 'projects'> {
  const data = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!data) return { workHistory: [], education: [], projects: [] };
  return {
    workHistory: toWorkHistory(data.workHistory),
    education: toEducation(data.education),
    projects: toProjects(data.projects),
  };
}

export async function parseResumeWithLlm(
  text: string,
  llm: LlmSettings
): Promise<Pick<ParsedResume, 'workHistory' | 'education' | 'projects'>> {
  return parseLlmResponse(await runPrompt(`${LLM_PROMPT_HEADER}\n${text}`, llm));
}

export interface ParseOutcome {
  parsed: ParsedResume;
  /** Whether the AI pass ran, so the UI can explain a thin result honestly. */
  ai: 'off' | 'used' | 'failed';
  aiError?: string;
}

/**
 * Heuristics always run and own contact details and links, where regex beats a
 * model. The LLM refines the structured sections, where layouts vary too much
 * for regex alone. A model failure degrades to the heuristic result rather
 * than failing the whole import — but it is reported, never swallowed.
 */
export async function parseResume(text: string, llm: LlmSettings): Promise<ParseOutcome> {
  const heuristic = parseResumeHeuristic(text);
  if (llm.backend === null) return { parsed: heuristic, ai: 'off' };

  try {
    const structured = await parseResumeWithLlm(text, llm);
    // Keep whichever pass actually found something: the model is better at
    // messy layouts, but it sometimes returns nothing at all.
    return {
      parsed: {
        ...heuristic,
        workHistory: structured.workHistory.length ? structured.workHistory : heuristic.workHistory,
        education: structured.education.length ? structured.education : heuristic.education,
        projects: structured.projects.length ? structured.projects : heuristic.projects,
      },
      ai: 'used',
    };
  } catch (err) {
    return {
      parsed: heuristic,
      ai: 'failed',
      aiError: err instanceof Error ? err.message : 'The AI backend did not respond.',
    };
  }
}
