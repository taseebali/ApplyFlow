/**
 * Mappings the user has taught us: "on this site, that field is my phone
 * number". Scoped per hostname on purpose — a label like "Field 3" means
 * something on one ATS and nothing on another.
 */
export type FieldOverrides = Record<string, Record<string, string>>;

const OVERRIDES_KEY = 'fieldOverrides';

export function applyOverrideDefaults(stored: unknown): FieldOverrides {
  if (!stored || typeof stored !== 'object') return {};
  const result: FieldOverrides = {};
  for (const [host, mappings] of Object.entries(stored as Record<string, unknown>)) {
    if (!mappings || typeof mappings !== 'object') continue;
    const clean: Record<string, string> = {};
    for (const [signature, path] of Object.entries(mappings as Record<string, unknown>)) {
      if (typeof path === 'string' && path) clean[signature] = path;
    }
    if (Object.keys(clean).length) result[host] = clean;
  }
  return result;
}

export async function getFieldOverrides(): Promise<FieldOverrides> {
  const result = await browser.storage.local.get(OVERRIDES_KEY);
  return applyOverrideDefaults(result[OVERRIDES_KEY]);
}

/** Returns just the mappings for one hostname, which is all the filler needs. */
export async function getOverridesForHost(hostname: string): Promise<Record<string, string>> {
  return (await getFieldOverrides())[hostname] ?? {};
}

export async function setFieldOverride(
  hostname: string,
  signature: string,
  schemaPath: string
): Promise<void> {
  const all = await getFieldOverrides();
  all[hostname] = { ...all[hostname], [signature]: schemaPath };
  await browser.storage.local.set({ [OVERRIDES_KEY]: all });
}

export async function clearFieldOverrides(hostname?: string): Promise<void> {
  if (!hostname) {
    await browser.storage.local.set({ [OVERRIDES_KEY]: {} });
    return;
  }
  const all = await getFieldOverrides();
  delete all[hostname];
  await browser.storage.local.set({ [OVERRIDES_KEY]: all });
}
