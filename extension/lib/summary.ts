import { looksLikeReasoning, stripReasoning } from './model-output';
import { bulletsToText, type Profile } from './schema';

/**
 * A summary written from what the profile already says.
 *
 * The plan for this had two halves — read the summary off the resume when it
 * prints one, and write one when it does not — and only the first half was
 * built. A resume with no SUMMARY section therefore imported an empty summary,
 * the field stayed empty, and the tailored resume came out with no summary at
 * all. This is the other half.
 *
 * Written from the profile only. Same rule as everywhere else here: the model
 * rephrases what the user has already said and invents nothing, because a
 * summary is the first thing an interviewer reads back to you.
 */
export function buildSummaryPrompt(profile: Profile): string {
  const roles = profile.workHistory
    .map((role) =>
      [
        [role.title, role.company].filter(Boolean).join(' at '),
        bulletsToText(role.bullets),
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');

  const projects = profile.projects
    .map((project) =>
      [project.name, project.techStack, bulletsToText(project.bullets), project.outcomes]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');

  const education = profile.education
    .map((entry) => [entry.degree, entry.fieldOfStudy, entry.school].filter(Boolean).join(', '))
    .join('\n');

  return [
    'Write the summary line for the top of this resume.',
    '',
    'RULES:',
    '1. Two sentences, at most 45 words. It sits under the name and is read in about four seconds.',
    '2. Say what this person builds and what they are strongest at. Not what they want, not what they are looking for, not what they are passionate about.',
    '3. Use only what PROFILE states. Never introduce a technology, employer, number, or claim of seniority that is not there.',
    '4. No "results-driven", "passionate about", "proven track record", "detail-oriented", "fast-paced".',
    '5. Do not open with the person\'s name, and do not write in the third person.',
    '6. Return only the summary text. No heading, no quotation marks, no commentary.',
    '',
    '<<<PROFILE>>>',
    profile.headline ? `Headline: ${profile.headline}` : '',
    profile.skills.length > 0 ? `Skills: ${profile.skills.join(', ')}` : '',
    education ? `Education:\n${education}` : '',
    roles ? `Experience:\n${roles}` : '',
    projects ? `Projects:\n${projects}` : '',
    '<<<END_PROFILE>>>',
    '',
    'Write the summary now.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Whether there is enough in the profile to write from at all. */
export function canWriteSummary(profile: Profile): boolean {
  const material =
    profile.workHistory.some((role) => role.bullets.length > 0) ||
    profile.projects.some((project) => project.bullets.length > 0);
  return material;
}

/**
 * Trims what the model returned to something that belongs on a resume.
 *
 * Models wrap a one-line answer in quotes and a preamble often enough that
 * stripping both is cheaper than another round trip.
 */
export class SummaryRefused extends Error {}

export function cleanSummary(raw: string): string {
  // The same guard every other caller of the model uses. It lived here first,
  // for summaries only, while drafted answers and cover letters had the same
  // hole — the fault is the model's, not this prompt's.
  const text = stripReasoning(raw)
    // The whole preamble up to and including the colon, not just its opening
    // words — "Here is the summary:" left "the summary:" behind.
    .replace(/^(here (is|are)|here's|sure|certainly)\b[^:]*:\s*/i, '')
    .replace(/^summary:\s*/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) throw new SummaryRefused('The model returned nothing.');

  if (looksLikeReasoning(text)) {
    throw new SummaryRefused(
      'The model returned its own working instead of a summary. Smaller free models often do this — try again, or pick a different model under Settings → AI.'
    );
  }

  // Two sentences at 45 words was the instruction. Triple that is not a summary
  // that drifted long; it is a different kind of output altogether.
  if (text.split(/\s+/).length > 140) {
    throw new SummaryRefused(
      'The model returned an essay rather than a summary line. Try again, or pick a different model under Settings → AI.'
    );
  }

  return text;
}
