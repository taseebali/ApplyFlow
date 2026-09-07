import { pruneCooldowns, withCooldown, type Cooldowns } from './model-router';

/**
 * Which models recently refused, so the next request starts elsewhere. Session
 * storage, not local: a provider being busy is a fact about the next few
 * minutes, and it should not outlive the browser session.
 */
const KEY = 'model-cooldowns';

/**
 * Models the provider will not serve to this key at all — free models gated to
 * approved apps. Kept in local storage rather than session, because the answer
 * does not change when the browser restarts, and re-learning it costs a failed
 * request and a "Test connection" that reports failure on a pool of eighteen
 * working models.
 */
const UNAVAILABLE_KEY = 'model-unavailable';

/** Long enough to be permanent in practice, short enough that a policy change eventually reaches us. */
const UNAVAILABLE_MS = 30 * 24 * 60 * 60 * 1000;

function area() {
  return browser.storage.session ?? browser.storage.local;
}

export async function getCooldowns(now = Date.now()): Promise<Cooldowns> {
  const [session, local] = await Promise.all([area().get(KEY), browser.storage.local.get(UNAVAILABLE_KEY)]);
  // Both are "do not pick this one right now", so they merge into one map and
  // the router needs to know nothing about the difference.
  return pruneCooldowns(
    {
      ...((session[KEY] as Cooldowns | undefined) ?? {}),
      ...((local[UNAVAILABLE_KEY] as Cooldowns | undefined) ?? {}),
    },
    now
  );
}

export async function recordUnavailable(modelId: string, now = Date.now()): Promise<void> {
  const stored = await browser.storage.local.get(UNAVAILABLE_KEY);
  const current = pruneCooldowns((stored[UNAVAILABLE_KEY] as Cooldowns | undefined) ?? {}, now);
  await browser.storage.local.set({
    [UNAVAILABLE_KEY]: { ...current, [modelId]: now + UNAVAILABLE_MS },
  });
}

export async function recordFailure(modelId: string, now = Date.now()): Promise<void> {
  // Reads the session map alone, not the merged one: writing the merged map
  // back would copy the permanent entries into session storage, where they do
  // not belong and would be lost on restart anyway.
  const stored = await area().get(KEY);
  const current = pruneCooldowns((stored[KEY] as Cooldowns | undefined) ?? {}, now);
  await area().set({ [KEY]: withCooldown(current, modelId, now) });
}
