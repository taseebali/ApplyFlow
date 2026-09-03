import { isPublishable, scoreSection } from './bullet-quality';
import { ANGLES, makeVariant, type Angle, type BulletVariant } from './bullet-bank';
import { bulletsToText, type Profile, type ProjectEntry, type WorkHistoryEntry } from './schema';
import type { TargetFamily } from './target-families';

/**
 * Writes the bank: several framings of each piece of work, generated once so
 * that applying is only ever ranking.
 *
 * The rule that governs everything here is that **facts come from the user and
 * phrasing comes from the model**. It may reframe, reorder and re-emphasise
 * freely; it may not introduce a number, a technology or an outcome that is not
 * already in the source. An invented metric on a resume is discovered in an
 * interview.
 *
 * Every generated variant passes the same quality check the user's own bullets
 * are held to before it is allowed into the bank. That gate is why a bank
 * cannot contain the faults that scored a generated resume 40/100.
 */

/** One role or project, flattened so generation does not care which it was. */
export interface Source {
  id: string;
  /** "Senior Engineer at Revel8" or "ApplyFlow" — what the bullets are about. */
  label: string;
  facts: string;
  techStack: string;
}

export function sourcesFrom(profile: Profile): Source[] {
  const roles = profile.workHistory.map((w: WorkHistoryEntry) => ({
    id: w.id,
    label: [w.title, w.company].filter(Boolean).join(' at ') || 'Role',
    facts: bulletsToText(w.bullets),
    techStack: '',
  }));

  const projects = profile.projects.map((p: ProjectEntry) => ({
    id: p.id,
    label: p.name || 'Project',
    facts: [bulletsToText(p.bullets), p.outcomes].filter(Boolean).join('\n'),
    techStack: p.techStack,
  }));

  // Anything with no facts has nothing to reframe, and asking the model to
  // write from a title alone is exactly how invention starts.
  return [...roles, ...projects].filter((s) => s.facts.trim().length > 0);
}

export function buildGenerationPrompt(source: Source, families: TargetFamily[]): string {
  const familyNames = families.map((f) => f.name);

  const rules = [
    `You are rewriting one piece of a candidate's experience in ${ANGLES.length} different ways, for a bank of resume bullets.`,
    '',
    'RULES:',
    '1. Every fact must already appear in SOURCE. Never introduce a number, technology, employer, date, or outcome that is not there. If SOURCE has no metric, write the bullet without one — do not estimate.',
    '2. One bullet per framing. Each must open with a DIFFERENT strong verb. Never open two with the same word.',
    '3. Never open with: Responsible for, Worked on, Helped with, Assisted, Participated in, Leveraged, Utilized.',
    '4. Never use: cross-functional, fast-paced, team player, passionate about, proven track record, results-driven, detail-oriented.',
    '5. Active voice, one or two lines, no trailing full stop needed.',
    '6. Keep the candidate\'s own terminology for technologies and systems.',
    `7. Return only JSON, shaped: {"variants":[{"angle":"technical","domain":"${familyNames[0] ?? 'null'}","text":"..."}]}`,
    '   `domain` names which of the target families this framing suits best, or null if it suits all equally.',
    '',
    'THE FRAMINGS, one bullet each:',
    '- technical: what was built and how it works',
    '- scale: size, volume, throughput, breadth',
    '- impact: what measurably changed as a result',
    '- ownership: what the candidate drove or decided alone',
    '- collaboration: who they worked with and what that unblocked',
    '- delivery: shipping it — speed, reliability, getting it live',
    '',
    familyNames.length > 0
      ? `The candidate targets: ${familyNames.join(', ')}. Surface the facts those roles care about.`
      : 'No target roles are known; write each framing on its own merits.',
    '',
  ];

  return [
    rules.join('\n'),
    `SOURCE — ${source.label}`,
    source.techStack ? `Technologies: ${source.techStack}` : '',
    source.facts,
  ]
    .filter(Boolean)
    .join('\n');
}

const isAngle = (value: unknown): value is Angle => ANGLES.includes(value as Angle);

/**
 * Reads generated variants, dropping anything that fails the quality bar.
 *
 * Returns what was rejected as well as what was kept: a source item whose
 * variants were mostly discarded needs regenerating, and silently returning a
 * thin result would hide that.
 */
export function parseVariants(
  raw: string,
  sourceId: string
): { kept: BulletVariant[]; rejected: string[] } {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return { kept: [], rejected: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return { kept: [], rejected: [] };
  }

  const entries = (parsed as { variants?: unknown }).variants;
  if (!Array.isArray(entries)) return { kept: [], rejected: [] };

  const kept: BulletVariant[] = [];
  const rejected: string[] = [];
  const usedVerbs = new Set<string>();

  for (const entry of entries) {
    const record = entry as { angle?: unknown; text?: unknown; domain?: unknown };
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (!text || !isAngle(record.angle)) continue;

    if (!isPublishable(text)) {
      rejected.push(text);
      continue;
    }

    const variant = makeVariant({
      sourceId,
      angle: record.angle,
      text,
      domainHint: typeof record.domain === 'string' && record.domain !== 'null' ? record.domain : null,
    });

    // Rule 2 asked for a different verb each time. Enforcing it here rather
    // than trusting the answer is the difference between a constraint and a
    // request — and a bank full of one verb is the original 40/100 fault.
    if (usedVerbs.has(variant.openingVerb)) {
      rejected.push(text);
      continue;
    }
    usedVerbs.add(variant.openingVerb);
    kept.push(variant);
  }

  return { kept, rejected };
}

/**
 * Whether a source item's generated variants are good enough to keep, or
 * whether the item is worth one more attempt.
 */
export function needsRetry(kept: BulletVariant[]): boolean {
  // Fewer than half the angles came back usable.
  return kept.length < Math.ceil(ANGLES.length / 2);
}

/** Source items with no measurable outcome anywhere — the enrichment questions. */
export function sourcesMissingMetrics(sources: Source[]): Source[] {
  return sources.filter((source) => !/\d/.test(source.facts));
}

/** The bank's own quality, reported the same way a section of bullets is. */
export function bankScore(variants: BulletVariant[]): number {
  return scoreSection(variants.map((v) => v.text)).score;
}
