import { asProse, ModelReasoned } from './model-output';
import { getBank } from './bullet-bank';
import { tailorFromProfile } from './direct-tailor';
import { getProfile } from './storage';
import { getSettings } from './settings';
import { runPrompt } from './llm-client';
import { bulletsToText } from './schema';
import { vocabularyFrom } from './tech-terms';
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
import { detectLanguage, type LetterLanguage } from './letter-language';
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
  /**
   * Whether to spend a request asking the model to rank the shortlist. False
   * when the resume is only being selected to feed a cover letter: selection
   * is local and costs nothing, and the letter does not read the ordering.
   */
  rank?: boolean;
}): Promise<TailorResult> {
  const { jobDescription, family = null, families = [], maxPerSource = 3, rank = true } = input;

  const [profile, bank, settings] = await Promise.all([getProfile(), getBank(), getSettings()]);
  const hasBank = Boolean(bank && bank.variants.length > 0);

  /*
   * Two routes to the same shortlist.
   *
   * With a bank, selection is free: the writing already happened, so this is
   * term overlap plus one small ranking call. Without one, the bullets are
   * written for this posting in a single request — which is the whole of the
   * cost, and is why no ranking call follows it. The variants are the same
   * shape either way, so everything below this point is identical.
   *
   * A missing bank used to be a hard error telling the user to go and generate
   * one first. Nothing about tailoring actually required it: every fact a
   * bullet can contain is in the profile.
   */
  let candidates: BulletVariant[];
  let offline = true;
  let variantPool: BulletVariant[];

  if (hasBank) {
    const angles = families.length > 0 ? anglesForFamily(families, family) : DEFAULT_ANGLES;
    candidates = shortlist({ jobDescription, bank: bank!.variants, family, angles });
    variantPool = bank!.variants;

    // Relevance is the model's judgement; without one, term overlap already
    // ordered the shortlist, so the feature degrades rather than disappears.
    if (rank && settings.llm.backend) {
      try {
        const reply = await runPrompt(buildRankingPrompt(jobDescription, candidates), settings.llm);
        candidates = applyRanking(candidates, parseRanking(reply));
        offline = false;
      } catch {
        // A ranking failure is not worth losing the resume over.
      }
    }
  } else {
    const direct = await tailorFromProfile(profile, jobDescription, settings.llm);
    // Already written against this posting, and already in the order the model
    // returned them. Ranking what was just written for the job would be paying
    // twice to ask the same question.
    candidates = direct.variants;
    variantPool = direct.variants;
    offline = false;
  }

  const ordered = candidates;

  // Variety and per-role limits are not matters of judgement, so they are
  // applied after the model and override it.
  const { selected } = enforceConstraints(ordered, { maxPerSource });
  const document = assembleResume(profile, selected, jobDescription);

  const profileText = [
    ...profile.workHistory.map((w) => bulletsToText(w.bullets)),
    ...profile.projects.map((p) => `${bulletsToText(p.bullets)} ${p.techStack}`),
    ...variantPool.map((v) => v.text),
  ].join('\n');

  return {
    document,
    selected,
    gap: analyseGap({
      jobDescription,
      profileText,
      // The candidate's own skills and tech stacks count as things a posting
      // can ask for, so matching improves as the profile does rather than
      // depending on a general vocabulary being complete.
      vocabulary: vocabularyFrom(profile.skills, profile.projects.map((p) => p.techStack)),
    }),
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
  /** Detected from the posting, and overridable before anything is saved. */
  language: LetterLanguage;
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
  /** Overrides detection, for a bilingual posting where detection is a coin flip. */
  language?: LetterLanguage;
}): Promise<CoverLetterResult> {
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  if (!settings.llm.backend) {
    throw new Error('A cover letter needs an AI backend. Set one up in Settings.');
  }

  const language = input.language ?? detectLanguage(input.jobDescription);
  const prompt = buildCoverLetterPrompt({
    jobDescription: input.jobDescription,
    profile,
    company: input.company,
    role: input.role,
    resumeBullets: input.resumeBullets,
    language,
  });

  const bulletTexts = input.resumeBullets.map((v) => v.text);
  const posting = { company: input.company, role: input.role };
  const faultsOf = (text: string) => coverLetterFaults(text, bulletTexts, posting);

  /*
   * A reply that is the model's own deliberation rather than a letter has no
   * letter inside it to keep, so it falls through to the retry that already
   * exists here instead of failing the run. Only when both attempts come back
   * as working does the error reach the user.
   */
  const attempt = async (): Promise<string | null> => {
    try {
      return asProse(await runPrompt(prompt, settings.llm));
    } catch (err) {
      if (err instanceof ModelReasoned) return null;
      throw err;
    }
  };

  const first = await attempt();
  if (first && isAcceptable(first, bulletTexts, posting)) {
    return { text: first, faults: faultsOf(first), retried: false, language };
  }

  const second = await attempt();
  const usable = [first, second].filter((text): text is string => text !== null);
  if (usable.length === 0) {
    throw new ModelReasoned(
      'The model wrote out its own reasoning twice instead of a cover letter. Smaller free models often do this — try again, or pick a different model under Settings → AI.'
    );
  }

  // Keep whichever is less wrong, so a retry can never make things worse.
  const best = usable.reduce((a, b) => (faultsOf(b).length < faultsOf(a).length ? b : a));

  return { text: best, faults: faultsOf(best), retried: true, language };
}
