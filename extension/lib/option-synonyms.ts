import { normalizeText } from './field-matcher';

/**
 * Application forms ask the same handful of things in endlessly different
 * words. Matching on wording alone therefore misses constantly: a profile
 * holding "Yes" has to find "I am authorised to work in Germany", and one
 * holding "Immediately" has to find "Available right away".
 *
 * Each group lists wordings that mean the same answer. Membership of the same
 * group is what makes two phrasings equivalent — order within it does not
 * matter.
 */
const SYNONYM_GROUPS: string[][] = [
  // Affirmative / negative, including the sentence forms dropdowns favour.
  ['yes', 'yes i do', 'yes i am', 'i do', 'i am', 'true', 'authorised', 'authorized', 'eligible'],
  ['no', 'no i do not', 'no i am not', 'i do not', 'i am not', 'false', 'not authorised', 'not authorized'],

  // Availability.
  ['immediately', 'immediately available', 'available immediately', 'right away', 'asap', 'now', 'at once'],
  ['1 month', 'one month', '4 weeks', 'a month'],
  ['2 months', 'two months', '8 weeks'],
  ['3 months', 'three months', '12 weeks', 'a quarter'],

  // Work authorisation.
  ['eu citizen', 'european union citizen', 'eu national', 'citizen of the eu'],
  ['permanent resident', 'permanent residency', 'settled status', 'niederlassungserlaubnis'],
  ['work visa holder', 'work permit', 'work visa', 'working visa', 'aufenthaltstitel'],
  ['student visa holder', 'student visa', 'student permit'],
  ['requires sponsorship', 'need sponsorship', 'requires visa sponsorship', 'sponsorship required'],

  // Working pattern.
  ['hybrid', 'hybrid model', 'partly remote', 'mix of office and home'],
  ['remote', 'fully remote', 'work from home', 'wfh'],
  ['on site', 'onsite', 'in office', 'office based'],

  // Language levels, both CEFR and prose.
  ['native', 'native speaker', 'mother tongue', 'c2', 'fluent'],
  ['c1', 'advanced', 'professional working proficiency'],
  ['b2', 'upper intermediate'],
  ['b1', 'intermediate'],
  ['a2', 'elementary', 'basic'],
  ['a1', 'beginner'],

  // Decline-to-answer wordings, which every EEO section words differently.
  [
    'decline to self identify',
    'prefer not to say',
    'i do not want to answer',
    'i decline to self identify',
    'do not wish to disclose',
  ],
];

/** Every wording that means the same as `value`, including `value` itself. */
export function synonymsFor(value: string): string[] {
  const target = normalizeText(value);
  if (!target) return [];
  const group = SYNONYM_GROUPS.find((g) => g.includes(target));
  return group ? group.slice() : [target];
}

/** Whether two wordings are recorded as meaning the same answer. */
export function meansTheSame(a: string, b: string): boolean {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return SYNONYM_GROUPS.some((group) => group.includes(left) && group.includes(right));
}
