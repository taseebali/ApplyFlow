import { contentTerms } from './bullet-bank';
import { TECH_TERMS } from './tech-terms';

/**
 * What the posting asks for that your profile never mentions.
 *
 * Needs no model, costs nothing, and is plausibly the most useful thing this
 * feature produces: it tells you the posting wants Kubernetes and you have
 * never written the word, which is something you can act on. Tailoring can
 * reorder what you have; it cannot cover a gap.
 *
 * Deliberately reports rather than pads. Stuffing a resume with terms you
 * cannot back up fails the interview instead of the filter.
 */

/**
 * Words a posting is full of that say nothing about the skills it needs. This
 * is the difference between a useful gap list and a list of the word "team".
 */
const BOILERPLATE = new Set([
  'you', 'your', 'our', 'we', 'us', 'they', 'their', 'will', 'can', 'should', 'must', 'may',
  'work', 'working', 'role', 'job', 'position', 'team', 'teams', 'company', 'business',
  'experience', 'years', 'year', 'skills', 'ability', 'able', 'strong', 'good', 'great',
  'excellent', 'knowledge', 'understanding', 'familiar', 'familiarity', 'plus', 'nice',
  'benefits', 'salary', 'apply', 'application', 'candidate', 'candidates', 'applicants',
  'opportunity', 'opportunities', 'environment', 'culture', 'people', 'help', 'helping',
  'new', 'other', 'others', 'well', 'also', 'such', 'more', 'most', 'about', 'who', 'what',
  'when', 'where', 'how', 'all', 'any', 'both', 'each', 'every', 'some', 'you.ll', 'youll',
  'looking', 'join', 'joining', 'offer', 'offers', 'including', 'include', 'includes',
  'etc', 'e.g', 'i.e', 'per', 'within', 'across', 'using', 'use', 'used', 'like', 'would',
  // Contraction tails. The tokenizer turns an apostrophe into a space, so
  // "you'll" arrives as "you" and "ll" — and "ll" was showing up as something
  // the posting supposedly asks for.
  'll', 've', 're', 'don', 'doesn', 'isn', 'aren', 'won', 'didn',
  // Common verbs. No posting asks for the skill "built": these describe what
  // the work involves, not what it requires, and they crowd out the terms that
  // do. Kept to verbs that are never themselves a technology — "test", "data",
  // "design" and "build" stay, because those are real asks in this field —
  // and neither does "Go", which is a language before it is a verb.
  'find', 'finding', 'found', 'built', 'make', 'making', 'made', 'get', 'getting', 'got',
  'take', 'taking', 'give', 'giving', 'want', 'wants', 'need', 'needs', 'know', 'knows',
  'see', 'seen', 'come', 'comes', 'keep', 'keeps', 'put', 'let', 'say', 'says',
  'ship', 'shipping', 'bring', 'brings', 'drive', 'driving', 'ensure', 'ensuring',
  'support', 'supporting', 'deliver', 'delivering', 'grow', 'growing', 'learn', 'learning',
  // Generic nouns and qualifiers that survive the verb list.
  'why', 'day', 'days', 'week', 'weeks', 'month', 'months', 'time', 'times', 'way', 'ways',
  'thing', 'things', 'part', 'parts', 'lot', 'lots', 'kind', 'sort', 'level', 'levels',
  'manual', 'manually', 'flow', 'first', 'next', 'last', 'own', 'here', 'there', 'much',
  'many', 'one', 'two', 'three', 'really', 'very', 'just', 'even', 'still', 'always', 'never',
]);

export interface GapTerm {
  term: string;
  /** How often the posting mentions it — a repeated ask is a stronger signal. */
  mentions: number;
}

export interface GapReport {
  /** Asked for, never mentioned anywhere in your profile or bank. */
  missing: GapTerm[];
  /** Asked for and present — what the posting and your profile agree on. */
  covered: GapTerm[];
}

/**
 * Terms the posting leans on, most-mentioned first. Repetition is the only
 * signal available for importance without a model, and it is a decent one:
 * postings repeat what they actually care about.
 */
export function postingTerms(jobDescription: string): Map<string, number> {
  const counts = new Map<string, number>();

  // Counted with repeats, unlike `contentTerms`, which deduplicates.
  const words = jobDescription
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[-.]+|[-.]+$/g, ''))
    .filter((w) => w.length >= 2 && !BOILERPLATE.has(w));

  // Only terms that survive the shared content filter, so stopwords are
  // handled in exactly one place.
  const allowed = new Set(contentTerms(jobDescription));
  for (const word of words) {
    if (!allowed.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return counts;
}

export function analyseGap(input: {
  jobDescription: string;
  /** Everything the candidate has written: bullets, tech stacks, skills. */
  profileText: string;
  /** The candidate's own skill and technology terms, which count as asks by definition. */
  vocabulary?: Set<string>;
  limit?: number;
}): GapReport {
  const { jobDescription, profileText, vocabulary = new Set<string>(), limit = 8 } = input;
  const known = new Set(contentTerms(profileText));

  const missing: GapTerm[] = [];
  const covered: GapTerm[] = [];

  for (const [term, mentions] of postingTerms(jobDescription)) {
    /*
     * A positive gate, not a stoplist.
     *
     * Subtracting filler from every word in the posting reported "und", "die",
     * "mit" and "bei" as requirements on a German posting, and "why", "days"
     * and "built" on an English one — because the stoplist can only ever be as
     * complete as the last posting that embarrassed it. A term now has to be
     * recognisably a skill before it can be a requirement at all.
     */
    if (!TECH_TERMS.has(term) && !vocabulary.has(term)) continue;
    (known.has(term) ? covered : missing).push({ term, mentions });
  }

  const byMentions = (a: GapTerm, b: GapTerm) => b.mentions - a.mentions || a.term.localeCompare(b.term);

  return {
    missing: missing.sort(byMentions).slice(0, limit),
    covered: covered.sort(byMentions).slice(0, limit),
  };
}

