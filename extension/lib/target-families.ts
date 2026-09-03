import { runPrompt } from './llm-client';
import { bulletsToText, type Profile } from './schema';
import type { LlmSettings } from './settings';
import { ANGLES, type Angle } from './bullet-bank';

/**
 * Which kinds of role this profile plausibly applies to, and how each prefers
 * its achievements framed.
 *
 * Run once, before the bank is generated, because the answer changes what gets
 * generated: framing a full-stack project for a frontend role means surfacing
 * different facts, not rewording the same ones.
 *
 * The result is shown to the user for approval rather than used directly. A
 * wrong inference biases the vocabulary of an entire bank, and that is
 * expensive to discover after several hundred variants exist.
 */

export interface TargetFamily {
  name: string;
  /** Ordered, strongest first. Sets which framings a posting in this family prefers. */
  angles: Angle[];
}

const PROMPT_HEADER = [
  'You are reading a candidate profile and naming the kinds of role they could plausibly apply to.',
  '',
  'RULES:',
  '1. Name at most four families, using ordinary industry titles ("Backend Engineer", "Applied ML", "Data Engineering"). No invented categories.',
  '2. Base them only on the experience below. Do not suggest a direction the profile shows no evidence for.',
  `3. For each, order these framings by how much that kind of role values them: ${ANGLES.join(', ')}.`,
  '4. Return only JSON, shaped: {"families":[{"name":"...","angles":["impact","technical", ...]}]}',
  '',
].join('\n');

export function buildFamiliesPrompt(profile: Profile): string {
  const work = profile.workHistory
    .map((w) => `- ${w.title} at ${w.company}: ${bulletsToText(w.bullets)}`)
    .join('\n');
  const projects = profile.projects
    .map((p) => `- ${p.name}: ${bulletsToText(p.bullets)} (tech: ${p.techStack})`)
    .join('\n');
  const education = profile.education.map((e) => `- ${e.degree} in ${e.fieldOfStudy}, ${e.school}`).join('\n');

  return [
    PROMPT_HEADER,
    'WORK HISTORY:',
    work || '(none)',
    '',
    'PROJECTS:',
    projects || '(none)',
    '',
    'EDUCATION:',
    education || '(none)',
  ].join('\n');
}

const isAngle = (value: unknown): value is Angle => ANGLES.includes(value as Angle);

/**
 * Reads the model's answer defensively. A malformed reply must degrade to "no
 * families", which generates a perfectly usable bank with no domain hints —
 * not throw away the run.
 */
export function parseFamilies(raw: string): TargetFamily[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return [];
  }

  const families = (parsed as { families?: unknown }).families;
  if (!Array.isArray(families)) return [];

  return families
    .map((entry) => {
      const record = entry as { name?: unknown; angles?: unknown };
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const angles = Array.isArray(record.angles) ? record.angles.filter(isAngle) : [];
      // Any angle the model left out still belongs in the mix, just last.
      const complete = [...angles, ...ANGLES.filter((a) => !angles.includes(a))];
      return { name, angles: complete };
    })
    .filter((family) => family.name.length > 0)
    .slice(0, 4);
}

export async function inferTargetFamilies(profile: Profile, llm: LlmSettings): Promise<TargetFamily[]> {
  return parseFamilies(await runPrompt(buildFamiliesPrompt(profile), llm));
}

/**
 * The angle order to use when nothing is known about the posting's family.
 * Impact first because a measurable outcome reads well to every reader.
 */
export const DEFAULT_ANGLES: Angle[] = ['impact', 'technical', 'scale', 'ownership', 'delivery', 'collaboration'];

/** The preferred framing order for a posting, falling back when its family is unknown. */
export function anglesForFamily(families: TargetFamily[], familyName: string | null): Angle[] {
  if (!familyName) return DEFAULT_ANGLES;
  const match = families.find((f) => f.name.toLowerCase() === familyName.toLowerCase());
  return match?.angles ?? DEFAULT_ANGLES;
}
