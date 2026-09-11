import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateApplicationLog, LEGACY_KEY } from './application-migrate';
import { clearRecords, listRecords } from './application-db';

const legacy = {
  id: 'old-1',
  appliedAt: 1000,
  company: 'Enpal',
  title: 'AI Intern',
  url: 'https://x/1',
  hostname: 'x',
  filledCount: 11,
  invalidCount: 2,
  questionsDrafted: 3,
  documentsAttached: 1,
  loggedToNotion: true,
};

function stubStorage(initial: Record<string, unknown>) {
  const store = { ...initial };
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => Object.assign(store, items),
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
  });
  return store;
}

beforeEach(async () => {
  await clearRecords();
  vi.unstubAllGlobals();
});

describe('migrateApplicationLog', () => {
  it('moves an old entry across, keeping its id and counts', async () => {
    stubStorage({ [LEGACY_KEY]: [legacy] });
    expect(await migrateApplicationLog()).toBe(1);

    const [record] = await listRecords();
    expect(record!.id).toBe('old-1');
    expect(record!.filledCount).toBe(11);
    expect(record!.status).toBe('applied');
  });

  it('leaves the fields an old entry never had empty rather than inventing them', async () => {
    // An entry from before this existed has no job description and no
    // documents. Filling those with plausible defaults would be a lie the
    // dashboard then reports as fact.
    stubStorage({ [LEGACY_KEY]: [legacy] });
    await migrateApplicationLog();
    const [record] = await listRecords();
    expect(record!.jobDescription).toBe('');
    expect(record!.resume).toBeNull();
    expect(record!.matchScore).toBeNull();
  });

  it('runs twice without duplicating anything', async () => {
    const store = stubStorage({ [LEGACY_KEY]: [legacy] });
    await migrateApplicationLog();
    expect(await migrateApplicationLog()).toBe(0);
    expect(await listRecords()).toHaveLength(1);
    expect(store[LEGACY_KEY]).toBeUndefined();
  });

  it('does nothing when there was never an old log', async () => {
    stubStorage({});
    expect(await migrateApplicationLog()).toBe(0);
  });
});
