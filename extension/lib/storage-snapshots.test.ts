import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSnapshots, restoreSnapshot, setProfile, snapshotProfile } from './storage';
import { EMPTY_PROFILE } from './schema';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
      },
    },
  });
});

const withName = (firstName: string) => ({ ...EMPTY_PROFILE, contact: { ...EMPTY_PROFILE.contact, firstName } });

describe('profile snapshots', () => {
  it('captures what the profile held before a destructive change', async () => {
    await setProfile(withName('Jordan'));
    await snapshotProfile('before importing a resume');

    const snapshots = await getSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.profile.contact.firstName).toBe('Jordan');
    expect(snapshots[0]!.reason).toContain('resume');
  });

  it('keeps the newest first and bounds how many are stored', async () => {
    for (let i = 0; i < 8; i++) {
      await setProfile(withName(`name${i}`));
      await snapshotProfile(`change ${i}`);
    }
    const snapshots = await getSnapshots();
    expect(snapshots.length).toBeLessThanOrEqual(5);
    expect(snapshots[0]!.profile.contact.firstName).toBe('name7');
  });

  it('restores an earlier profile', async () => {
    await setProfile(withName('original'));
    await snapshotProfile('before the import');
    await setProfile(withName('clobbered'));

    const [snapshot] = await getSnapshots();
    expect(await restoreSnapshot(snapshot!.takenAt)).toBe(true);

    const restored = (await getSnapshots())[0];
    // Restoring snapshots the clobbered state first, so it is also reversible.
    expect(restored!.profile.contact.firstName).toBe('clobbered');
  });

  it('reports a missing snapshot rather than throwing', async () => {
    expect(await restoreSnapshot(12345)).toBe(false);
  });
});
