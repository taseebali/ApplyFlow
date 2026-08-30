import { pruneCooldowns, withCooldown, type Cooldowns } from './model-router';

/**
 * Which models recently refused, so the next request starts elsewhere. Session
 * storage, not local: a provider being busy is a fact about the next few
 * minutes, and it should not outlive the browser session.
 */
const KEY = 'model-cooldowns';

function area() {
  return browser.storage.session ?? browser.storage.local;
}

export async function getCooldowns(now = Date.now()): Promise<Cooldowns> {
  const stored = await area().get(KEY);
  return pruneCooldowns((stored[KEY] as Cooldowns | undefined) ?? {}, now);
}

export async function recordFailure(modelId: string, now = Date.now()): Promise<void> {
  const current = await getCooldowns(now);
  await area().set({ [KEY]: withCooldown(current, modelId, now) });
}
