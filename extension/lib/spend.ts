import { getCachedModels, type CatalogModel } from './openrouter-catalog';
import type { Completion } from './openrouter-errors';

/**
 * What this extension has spent, running total.
 *
 * Per-run cost already appeared on the drafting card, which covered the one
 * place spending was expected and none of the places it actually happened: a
 * bank generation is dozens of requests and reported nothing at all. $0.20
 * went out that way before anyone noticed, and the first news of it was the
 * OpenRouter dashboard.
 *
 * Priced when recorded rather than when read, because the catalogue is a cache
 * that can be refreshed or evicted, and a total that changes retroactively is
 * worse than no total.
 */
const KEY = 'spend-total-v1';

export interface Spend {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** Only what could be priced. Requests with an unknown model add to `unpriced`. */
  usd: number;
  /** Requests whose model was not in the catalogue, so nothing can be claimed about them. */
  unpriced: number;
  /** Requests that cost something. One of these under a free-only policy is a bug. */
  paid: number;
  /** When counting started, so "since" can be shown and the total can be reset. */
  since: number;
}

export const EMPTY_SPEND: Spend = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  usd: 0,
  unpriced: 0,
  paid: 0,
  since: 0,
};

export async function getSpend(): Promise<Spend> {
  const stored = await browser.storage.local.get(KEY);
  const spend = stored[KEY] as Spend | undefined;
  return spend && typeof spend.requests === 'number' ? spend : EMPTY_SPEND;
}

export async function resetSpend(): Promise<void> {
  await browser.storage.local.set({ [KEY]: { ...EMPTY_SPEND, since: Date.now() } satisfies Spend });
}

/** Adds one completion to the running total. Pure, so the arithmetic is testable. */
export function addCompletion(
  spend: Spend,
  completion: { model?: string; usage?: { input: number; output: number } },
  catalogue: CatalogModel[],
  now: number
): Spend {
  const model = completion.model ? catalogue.find((m) => m.id === completion.model) : undefined;
  const input = completion.usage?.input ?? 0;
  const output = completion.usage?.output ?? 0;
  const cost = model ? input * model.promptPrice + output * model.completionPrice : 0;

  return {
    requests: spend.requests + 1,
    inputTokens: spend.inputTokens + input,
    outputTokens: spend.outputTokens + output,
    usd: spend.usd + cost,
    unpriced: spend.unpriced + (model ? 0 : 1),
    paid: spend.paid + (cost > 0 ? 1 : 0),
    since: spend.since || now,
  };
}

/**
 * Records one completion. Never throws: a failed write must not fail the run
 * the user actually asked for, and a missing catalogue is a reason to record
 * the request as unpriced rather than to skip it.
 */
export async function recordSpend(completion: Completion): Promise<void> {
  try {
    // Cache only. Pricing a request must never itself become a request.
    const catalogue = await getCachedModels();
    const next = addCompletion(await getSpend(), completion, catalogue, Date.now());
    await browser.storage.local.set({ [KEY]: next });
  } catch {
    // Accounting is an extra. Losing a line of it is not worth an error the
    // user cannot act on.
  }
}

/** Sub-cent totals are the normal case, so "$0.00" would read as "nothing". */
export function formatSpend(spend: Spend): string {
  if (spend.requests === 0) return 'Nothing sent yet';
  const requests = `${spend.requests} request${spend.requests === 1 ? '' : 's'}`;
  if (spend.paid === 0) return `${requests}, free`;
  if (spend.usd < 0.01) return `${requests}, under a cent`;
  return `${requests}, $${spend.usd.toFixed(2)}`;
}
