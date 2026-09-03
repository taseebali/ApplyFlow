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
import {
  buildCoverLetterPrompt,
  coverLetterFaults,
  isAcceptable,
  type LetterFault,
} from './cover-letter';
import type { BulletVariant } from './bullet-bank';

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
  /** The variants that made it onto the resume — what the letter must not repeat. */
  selected: BulletVariant[];
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
    selected,
    gap: analyseGap({ jobDescription, profileText }),
    score: scoreSection(selected.map((v) => v.text)).score,
    offline,
  };
}

export interface CoverLetterResult {
  text: string;
  /** What is still wrong with it after generation, for the user to judge. */
  faults: LetterFault[];
  /** True when a second attempt was needed, so a poor result is explicable. */
  retried: boolean;
}

/**
 * Writes the cover letter for this posting.
 *
 * Retried once when the result has a structural fault — a templated opening,
 * three sentences starting the same way, a restatement of the resume. Retrying
 * once rather than repeatedly is the same judgement as bank generation: a model
 * that produces the same fault twice will not fix it on the third attempt, and
 * the user can edit what comes back.
 */
export async function writeCoverLetter(input: {
  jobDescription: string;
  company: string;
  role: string;
  resumeBullets: BulletVariant[];
}): Promise<CoverLetterResult> {
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  if (!settings.llm.backend) {
    throw new Error('A cover letter needs an AI backend. Set one up in Settings.');
  }

  const prompt = buildCoverLetterPrompt({
    jobDescription: input.jobDescription,
    profile,
    company: input.company,
    role: input.role,
    resumeBullets: input.resumeBullets,
  });

  const bulletTexts = input.resumeBullets.map((v) => v.text);

  const first = (await runPrompt(prompt, settings.llm)).trim();
  if (isAcceptable(first, bulletTexts)) {
    return { text: first, faults: coverLetterFaults(first, bulletTexts), retried: false };
  }

  const second = (await runPrompt(prompt, settings.llm)).trim();
  // Keep whichever is less wrong, so a retry can never make things worse.
  const best = coverLetterFaults(second, bulletTexts).length < coverLetterFaults(first, bulletTexts).length
    ? second
    : first;

  return { text: best, faults: coverLetterFaults(best, bulletTexts), retried: true };
}
