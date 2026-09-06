/**
 * Which language this application should be written in.
 *
 * A German posting answered with an English letter reads as an applicant who
 * did not look, and the conventions differ by more than vocabulary: a German
 * Anschreiben has a subject line and a fixed salutation, and skipping them is
 * conspicuous in a way that no amount of good prose recovers.
 *
 * Stopword frequency rather than a model — it costs nothing, works offline and
 * is more reliable here than a model would be, because postings are long and
 * function words are the densest signal in them.
 */

export type LetterLanguage = 'en' | 'de';

/**
 * Function words, not vocabulary. "Engineering" and "Software" appear in both
 * languages' postings; "und" and "the" do not.
 */
const MARKERS: Record<LetterLanguage, string[]> = {
  de: [
    'und', 'der', 'die', 'das', 'für', 'mit', 'von', 'ist', 'sich', 'nicht',
    'auch', 'eine', 'einen', 'einem', 'wir', 'bei', 'oder', 'als', 'dem', 'den',
    'sowie', 'unser', 'unsere', 'unserem', 'werden', 'haben', 'dich', 'deine',
    'ihre', 'ihnen', 'zu', 'im', 'am', 'aus', 'auf', 'über', 'durch', 'kenntnisse',
    'aufgaben', 'erfahrung', 'bewerbung', 'mitarbeiter', 'stelle',
  ],
  en: [
    'the', 'and', 'for', 'with', 'you', 'your', 'our', 'are', 'will', 'that',
    'this', 'have', 'from', 'they', 'has', 'been', 'their', 'about', 'what',
    'who', 'work', 'role', 'team', 'we', 'to', 'in', 'on', 'of', 'as', 'is',
  ],
};

/** How strongly each language's function words show up, per thousand words. */
function markerRate(words: string[], language: LetterLanguage): number {
  if (words.length === 0) return 0;
  const markers = new Set(MARKERS[language]);
  const hits = words.reduce((sum, word) => sum + (markers.has(word) ? 1 : 0), 0);
  return (hits / words.length) * 1000;
}

/**
 * The language a posting is written in.
 *
 * Defaults to English when there is nothing to go on. That is the safer
 * failure: an English letter to a German company is ordinary, while a German
 * letter written from a misread signal is not recoverable by the reader.
 */
export function detectLanguage(jobDescription: string): LetterLanguage {
  const words = jobDescription
    .toLowerCase()
    .replace(/[^a-zäöüß\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // Too little text to judge; guessing German off two words would be worse
  // than defaulting.
  if (words.length < 20) return 'en';

  return markerRate(words, 'de') > markerRate(words, 'en') ? 'de' : 'en';
}

/** Everything about a letter that is fixed by its language rather than written. */
export interface LetterConventions {
  /** "Bewerbung als Software Engineer" — German letters require one. */
  subject: (role: string) => string;
  salutation: (company: string) => string;
  closing: string;
  /** How the date is written above the recipient block. */
  formatDate: (date: Date) => string;
  /** German business letters put the date right, English convention varies. */
  dateOnRight: boolean;
}

export const CONVENTIONS: Record<LetterLanguage, LetterConventions> = {
  en: {
    subject: (role) => (role ? `Application for ${role}` : 'Application'),
    // Named team over "Sir or Madam": warmer, and still correct when no
    // individual is known, which on an online application is almost always.
    salutation: (company) => (company ? `Dear Hiring Team at ${company},` : 'Dear Hiring Team,'),
    closing: 'Sincerely,',
    formatDate: (date) =>
      date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    dateOnRight: false,
  },
  de: {
    subject: (role) => (role ? `Bewerbung als ${role}` : 'Bewerbung'),
    // The standard form when no name is given. Addressing a named person is
    // better German practice, but inventing one is worse than the convention.
    salutation: () => 'Sehr geehrte Damen und Herren,',
    closing: 'Mit freundlichen Grüßen',
    formatDate: (date) => date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    dateOnRight: true,
  },
};
