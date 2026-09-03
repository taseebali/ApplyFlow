import { getBank } from './bullet-bank';
import { getProfile } from './storage';
import { getSettings } from './settings';
import { runPrompt } from './llm-client';
import { bulletsToText } from './schema';
import { analyseGap, type GapReport } from './keyword-gap';
import {
  applyRanking,
  buildRankingPrompt,
  enforceConstraints,
  parseRanking,
  shortlist,
} from './resume-selection';
import { anglesForFamily, DEFAULT_ANGLES, type TargetFamily } from './target-families';
import { assembleResume, type ResumeDocument } from './resume-document';
import { scoreSection } from './bullet-quality';

/**
 * Producing one application's resume, end to end.
 *
 * The shape here is deliberate: everything expensive already happened when the
 * bank was generated, so this is a shortlist (free), one small ranking call,
 * and then rules applied in code. Nothing is written, so nothing can be
 * invented at this stage.
 */

export interface TailorResult {
  document: ResumeDocument;
  gap: GapReport;
  /** The finished document's own quality, by the same measure as everything else. */
  score: number;
  /** True when no model was involved — the ordering is term overlap alone. */
  offline: boolean;
}

export async function tailorResume(input: {
  jobDescription: string;
  family?: string | null;
  families?: TargetFamily[];
  maxPerSource?: number;
}): Promise<TailorResult> {
  const { jobDescription, family = null, families = [], maxPerSource = 3 } = input;

  const [profile, bank, settings] = await Promise.all([getProfile(), getBank(), getSettings()]);
  if (!bank || bank.variants.length === 0) {
    throw new Error('No tailoring bank yet. Generate one under Setup → Tailoring bank.');
  }

  const angles = families.length > 0 ? anglesForFamily(families, family) : DEFAULT_ANGLES;
  const candidates = shortlist({ jobDescription, bank: bank.variants, family, angles });

  // Relevance is the model's judgement; without one, term overlap already
  // ordered the shortlist, so the feature degrades rather than disappears.
  let ordered = candidates;
  let offline = true;
  if (settings.llm.backend) {
    try {
      const reply = await runPrompt(buildRankingPrompt(jobDescription, candidates), settings.llm);
      ordered = applyRanking(candidates, parseRanking(reply));
      offline = false;
    } catch {
      // A ranking failure is not worth losing the resume over.
      ordered = candidates;
    }
  }

  // Variety and per-role limits are not matters of judgement, so they are
  // applied after the model and override it.
  const { selected } = enforceConstraints(ordered, { maxPerSource });
  const document = assembleResume(profile, selected);

  const profileText = [
    ...profile.workHistory.map((w) => bulletsToText(w.bullets)),
    ...profile.projects.map((p) => `${bulletsToText(p.bullets)} ${p.techStack}`),
    ...bank.variants.map((v) => v.text),
  ].join('\n');

  return {
    document,
    gap: analyseGap({ jobDescription, profileText }),
    score: scoreSection(selected.map((v) => v.text)).score,
    offline,
  };
}
