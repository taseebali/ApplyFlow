import { runPrompt } from './llm-client';
import { getProfile } from './storage';
import { getSettings } from './settings';
import {
  buildGenerationPrompt,
  needsRetry,
  parseVariants,
  sourcesFrom,
  sourcesMissingMetrics,
  type Source,
} from './bank-generation';
import { getBank, setBank, type BulletBank, type BulletVariant } from './bullet-bank';
import { inferTargetFamilies, type TargetFamily } from './target-families';

/**
 * Drives bank generation and reports progress.
 *
 * Lives outside the worker so the ordering is testable without a browser: the
 * worker owns *when* this runs, this owns *what* it does.
 *
 * Generation is front-loaded work that lands at onboarding, which is exactly
 * where people abandon a tool — so it runs in the background, reports progress
 * after every source item, and saves as it goes. A run abandoned halfway leaves
 * a partial bank that still works rather than nothing.
 */

export type BankRunStatus = 'inferring' | 'generating' | 'done' | 'done-with-gaps' | 'error';

export interface BankRunState {
  status: BankRunStatus;
  done: number;
  total: number;
  /** The item being worked on, so progress names something recognisable. */
  current: string | null;
  families: TargetFamily[];
  /** Source items with no measurable outcome — the enrichment questions. */
  needMetrics: Array<{ id: string; label: string }>;
  /**
   * Items that produced no usable variants, and why.
   *
   * A run that quietly reported success while writing nothing for half the
   * profile is what let a one-project resume look like a finished one. A
   * partial run is fine; a partial run that calls itself complete is not.
   */
  failed: Array<{ id: string; label: string; reason: string }>;
  message?: string;
}

const RUN_KEY = 'bank-run';

export async function getBankRun(): Promise<BankRunState | null> {
  const stored = await browser.storage.local.get(RUN_KEY);
  return (stored[RUN_KEY] as BankRunState | undefined) ?? null;
}

async function report(state: BankRunState): Promise<void> {
  await browser.storage.local.set({ [RUN_KEY]: state });
}

export interface BankRunOptions {
  /**
   * Families the user already approved. Passing them skips inference, which is
   * how a regeneration avoids re-asking a question that was already answered.
   */
  families?: TargetFamily[];
  /** Regenerate only these source items, leaving the rest of the bank alone. */
  onlySourceIds?: string[];
}

/**
 * Generates the bank, one source item per call.
 *
 * Batching by source rather than by angle keeps this to roughly eight requests
 * for a typical profile — inside even OpenRouter's un-credited 50-a-day free
 * cap, and well inside its 20-a-minute limit.
 */
export async function runBankGeneration(options: BankRunOptions = {}): Promise<void> {
  const fail = (message: string) =>
    report({
      status: 'error',
      done: 0,
      total: 0,
      current: null,
      families: [],
      needMetrics: [],
      failed: [],
      message,
    });

  try {
    const settings = await getSettings();
    if (!settings.llm.backend) {
      await fail('Set up AI drafting in Settings before generating a bank.');
      return;
    }

    const profile = await getProfile();
    const allSources = sourcesFrom(profile);
    const sources = options.onlySourceIds
      ? allSources.filter((s) => options.onlySourceIds!.includes(s.id))
      : allSources;

    if (sources.length === 0) {
      await fail('Nothing to generate from yet — add some achievements to your roles or projects first.');
      return;
    }

    const needMetrics = sourcesMissingMetrics(sources).map((s) => ({ id: s.id, label: s.label }));

    // Inference first: its answer changes what gets generated, so it cannot
    // run alongside.
    let families = options.families ?? [];
    if (families.length === 0) {
      await report({
        status: 'inferring',
        done: 0,
        total: sources.length,
        current: null,
        families: [],
        needMetrics,
        failed: [],
      });
      // A failure here is survivable: no families means no domain hints, which
      // is the design without the refinement rather than a broken run.
      families = await inferTargetFamilies(profile, settings.llm).catch(() => []);
    }

    const existing = await getBank();
    const kept: BulletVariant[] = options.onlySourceIds
      ? (existing?.variants ?? []).filter((v) => !options.onlySourceIds!.includes(v.sourceId))
      : [];

    const failed: BankRunState['failed'] = [];

    for (const [index, source] of sources.entries()) {
      await report({
        status: 'generating',
        done: index,
        total: sources.length,
        current: source.label,
        families,
        needMetrics,
        failed,
      });

      const { variants, reason } = await generateForSource(source, families, settings.llm);
      if (reason) failed.push({ id: source.id, label: source.label, reason });
      kept.push(...variants);

      // Saved after every item, so an interrupted run leaves a usable bank.
      await setBank(bankOf(kept, families, settings));
    }

    await report({
      status: failed.length > 0 ? 'done-with-gaps' : 'done',
      done: sources.length,
      total: sources.length,
      current: null,
      families,
      needMetrics,
      failed,
    });
  } catch (err) {
    await fail(err instanceof Error ? err.message : 'Could not generate the bank.');
  }
}

function bankOf(variants: BulletVariant[], families: TargetFamily[], settings: Awaited<ReturnType<typeof getSettings>>): BulletBank {
  const policy = settings.llm.modelPolicy;
  return {
    variants,
    generatedAt: Date.now(),
    // Recorded so an inconsistent bank can be traced to what wrote it.
    model: policy.kind === 'single' ? policy.model : `${policy.kind} policy`,
    families: families.map((f) => f.name),
  };
}

/**
 * One source item, with a single retry when most framings were discarded.
 *
 * Retrying once rather than repeatedly is deliberate: if a model produces
 * unusable bullets twice for the same input, the input is the problem and more
 * attempts only cost tokens.
 */
async function generateForSource(
  source: Source,
  families: TargetFamily[],
  llm: Awaited<ReturnType<typeof getSettings>>['llm']
): Promise<{ variants: BulletVariant[]; reason?: string }> {
  const prompt = buildGenerationPrompt(source, families);

  try {
    const first = parseVariants(await runPrompt(prompt, llm), source.id, source.facts);
    if (!needsRetry(first.kept)) return { variants: first.kept };

    const second = parseVariants(await runPrompt(prompt, llm), source.id, source.facts);
    const best = second.kept.length > first.kept.length ? second.kept : first.kept;
    return best.length > 0
      ? { variants: best }
      : { variants: [], reason: 'Every framing the model wrote failed the quality check.' };
  } catch (err) {
    // One failed item must not lose the items already generated — but it must
    // be named, or the resume quietly comes out short.
    return { variants: [], reason: err instanceof Error ? err.message : 'The model call failed.' };
  }
}
