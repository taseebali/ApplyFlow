import type { CatalogModel } from './openrouter-catalog';

/**
 * How a model is chosen for a request.
 *
 * `free-pool` exists because free endpoints are shared and saturate — the
 * failure that motivated all of this was one provider refusing at 16/16 worker
 * slots. Rotating across the free roster routes around that. It is also the
 * mode with a real privacy cost: free providers may train on what is sent, and
 * what is sent here includes the resume.
 */
export type ModelPolicy =
  | { kind: 'single'; model: string }
  | { kind: 'list'; models: string[] }
  | { kind: 'free-pool'; minContext: number };

/** Model id → the time it stops being skipped. */
export type Cooldowns = Record<string, number>;

export interface RouterInput {
  policy: ModelPolicy;
  catalogue: CatalogModel[];
  cooldowns: Cooldowns;
  now: number;
  /** Model id → recent uptime percentage, when it is known. Ranks the pool. */
  health?: Record<string, number>;
}

/** How long a model that just failed transiently is passed over. */
export const COOLDOWN_MS = 5 * 60 * 1000;

const isCooling = (id: string, cooldowns: Cooldowns, now: number) => (cooldowns[id] ?? 0) > now;

/**
 * The models to try, best first. The caller sends the first as `model` and the
 * rest as OpenRouter's own `models` array, so one request already walks a short
 * list; the ordering here is what carries knowledge between requests.
 *
 * Never returns an empty list when the policy names anything at all: a
 * cooling-off model is better than no model, so cooldowns reorder rather than
 * remove once there is nothing else left.
 */
export function nextCandidates(input: RouterInput, limit = 3): string[] {
  const { policy, catalogue, cooldowns, now, health = {} } = input;

  if (policy.kind === 'single') {
    return policy.model ? [policy.model] : [];
  }

  if (policy.kind === 'list') {
    const named = policy.models.filter((id) => id.length > 0);
    const ready = named.filter((id) => !isCooling(id, cooldowns, now));
    const cooling = named.filter((id) => isCooling(id, cooldowns, now));
    // Cooling models go last rather than being dropped, so a run never stalls
    // just because everything the user named failed once.
    return [...ready, ...cooling].slice(0, limit);
  }

  const pool = catalogue.filter((model) => model.isFree && model.contextLength >= policy.minContext);

  const rank = (model: CatalogModel) => {
    const uptime = health[model.id];
    // An unmeasured model sorts between a healthy one and a struggling one:
    // no evidence is not the same as evidence of trouble.
    return [uptime ?? 50, model.contextLength];
  };

  const byRank = (a: CatalogModel, b: CatalogModel) => {
    const [ua, ca] = rank(a);
    const [ub, cb] = rank(b);
    return ub! - ua! || cb! - ca!;
  };

  const ready = pool.filter((m) => !isCooling(m.id, cooldowns, now)).sort(byRank);
  const cooling = pool.filter((m) => isCooling(m.id, cooldowns, now)).sort(byRank);

  return [...ready, ...cooling].slice(0, limit).map((m) => m.id);
}

/** Marks a model as recently failed, so the next request looks elsewhere first. */
export function withCooldown(cooldowns: Cooldowns, modelId: string, now: number): Cooldowns {
  return { ...cooldowns, [modelId]: now + COOLDOWN_MS };
}

/** Drops expired entries so the record does not grow for the life of the session. */
export function pruneCooldowns(cooldowns: Cooldowns, now: number): Cooldowns {
  return Object.fromEntries(Object.entries(cooldowns).filter(([, until]) => until > now));
}

/** Reads a policy from settings saved before policies existed. */
export function policyFromLegacy(model: string, fallbacks: string): ModelPolicy {
  const extra = fallbacks
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== model);

  if (extra.length > 0) return { kind: 'list', models: [model, ...extra] };
  return { kind: 'single', model };
}
