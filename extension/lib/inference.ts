import { normalizeText } from './field-matcher';
import type { Profile } from './schema';

/**
 * Some questions have an answer that already follows from the profile, and
 * asking the user again is asking them to repeat themselves. If they have said
 * they are still studying, "are you currently enrolled at a university?" is
 * answered. If they live in Berlin, "are you based in Berlin?" is answered.
 *
 * Rules only fire when the profile actually settles the question. Anything
 * uncertain returns null and the field is left for the user, because a
 * confidently wrong answer on a real application is far worse than a blank.
 */
export interface InferenceRule {
  id: string;
  infer: (question: string, profile: Profile) => string | null;
}

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

/**
 * Whether the question names the city the user lives in. Returns null when
 * there is no saved city, since then it settles nothing. Each rule gates on
 * its own topic first, so this only has to answer the location part — a
 * hybrid question says "our Berlin office", never "where do you live".
 */
function questionMentionsHomeCity(question: string, profile: Profile): boolean | null {
  const city = normalizeText(profile.contact.city);
  if (!city) return null;
  return normalizeText(question).includes(city);
}

export const INFERENCE_RULES: InferenceRule[] = [
  {
    // "Are you currently enrolled at a German university/college?"
    id: 'currently-enrolled',
    infer: (question, profile) => {
      if (!/\b(enrolled|studying|a student|current student)\b/i.test(question)) return null;
      if (!profile.education.length) return null;
      return yesNo(profile.education.some((e) => e.current));
    },
  },
  {
    // "Are you currently based in Berlin?"
    id: 'based-in-city',
    infer: (question, profile) => {
      if (!/\b(based|located|living|live|reside)\b/i.test(question)) return null;
      const match = questionMentionsHomeCity(question, profile);
      return match === null ? null : yesNo(match);
    },
  },
  {
    // "Our team works in a hybrid model. Are you able to work from our Berlin
    // office at least 2 days per week?" — answerable when they already live
    // there, or have said they would relocate.
    id: 'hybrid-office-days',
    infer: (question, profile) => {
      if (!/\b(hybrid|office|on ?site|in person|days per week)\b/i.test(question)) return null;
      if (questionMentionsHomeCity(question, profile) === true) return 'Yes';
      if (profile.logistics.willingToRelocate === true) return 'Yes';
      return null;
    },
  },
  {
    // "Would you need to relocate for this role?" is the inverse of living
    // there already, so it must not reuse the 'based-in-city' answer directly.
    id: 'needs-to-relocate',
    infer: (question, profile) => {
      if (!/\brelocat/i.test(question)) return null;
      if (questionMentionsHomeCity(question, profile) === true) return 'No';
      if (profile.logistics.willingToRelocate === null) return null;
      return yesNo(profile.logistics.willingToRelocate);
    },
  },
  {
    // "When could you start?" / "What is your notice period?"
    id: 'availability',
    infer: (question, profile) => {
      if (!/\b(start|available|availability|notice period)\b/i.test(question)) return null;
      return profile.logistics.availableFrom || null;
    },
  },
];

/** The first rule that can settle this question, or null to leave it alone. */
export function inferAnswer(question: string, profile: Profile): string | null {
  if (!question.trim()) return null;
  for (const rule of INFERENCE_RULES) {
    const answer = rule.infer(question, profile);
    if (answer) return answer;
  }
  return null;
}
