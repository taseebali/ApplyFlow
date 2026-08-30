import type { CatalogModel } from './openrouter-catalog';

/**
 * What a drafting run actually cost.
 *
 * The free-model pool means a run can silently move between models and tiers,
 * so without this the user has no way to know whether a run was free, cost a
 * fraction of a cent, or hit a paid model they did not intend. Tokens come
 * from the provider's own response; the price comes from the OpenRouter
 * catalogue when the model is in it.
 */

export interface RunUsage {
  model: string;
  input: number;
  output: number;
}

export interface RunCost {
  inputTokens: number;
  outputTokens: number;
  /** Null when no model in the run had a known price — not the same as free. */
  usd: number | null;
  /** True when every model used is priced at zero. */
  free: boolean;
}

export function summarizeRunCost(usages: RunUsage[], catalogue: CatalogModel[]): RunCost {
  const priceOf = (id: string) => catalogue.find((m) => m.id === id);

  let usd = 0;
  let priced = 0;
  let free = usages.length > 0;

  for (const usage of usages) {
    const model = priceOf(usage.model);
    if (!model) {
      free = false;
      continue;
    }
    priced++;
    if (!model.isFree) free = false;
    usd += usage.input * model.promptPrice + usage.output * model.completionPrice;
  }

  return {
    inputTokens: usages.reduce((sum, u) => sum + u.input, 0),
    outputTokens: usages.reduce((sum, u) => sum + u.output, 0),
    usd: priced > 0 ? usd : null,
    free,
  };
}

/** Sub-cent amounts are the normal case here, so "$0.00" would be useless. */
export function formatCost(cost: RunCost): string {
  const tokens = `${cost.inputTokens + cost.outputTokens} tokens`;
  if (cost.free) return `${tokens}, free`;
  if (cost.usd === null) return tokens;
  if (cost.usd < 0.01) return `${tokens}, under a cent`;
  return `${tokens}, about $${cost.usd.toFixed(2)}`;
}
