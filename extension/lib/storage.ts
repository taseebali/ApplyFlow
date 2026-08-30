import { EMPTY_PROFILE, type Profile } from './schema';

const PROFILE_KEY = 'profile';

/** Backfills any top-level sections added to Profile after a user's data was last saved. */
export function applyProfileDefaults(stored: Partial<Profile>): Profile {
  return {
    contact: { ...EMPTY_PROFILE.contact, ...stored.contact },
    links: { ...EMPTY_PROFILE.links, ...stored.links },
    workHistory: stored.workHistory ?? EMPTY_PROFILE.workHistory,
    // Entries saved before `current` existed default to finished, which is
    // the safe reading: it never claims someone is still studying.
    education: (stored.education ?? EMPTY_PROFILE.education).map((entry) => ({
      ...entry,
      current: entry.current ?? false,
    })),
    projects: stored.projects ?? EMPTY_PROFILE.projects,
    languages: stored.languages ?? EMPTY_PROFILE.languages,
    workAuthorization: { ...EMPTY_PROFILE.workAuthorization, ...stored.workAuthorization },
    logistics: { ...EMPTY_PROFILE.logistics, ...stored.logistics },
    customQA: stored.customQA ?? EMPTY_PROFILE.customQA,
  };
}

export async function getProfile(): Promise<Profile> {
  const result = await browser.storage.local.get(PROFILE_KEY);
  const stored = result[PROFILE_KEY] as Partial<Profile> | undefined;
  return stored ? applyProfileDefaults(stored) : EMPTY_PROFILE;
}

export async function setProfile(profile: Profile): Promise<void> {
  await browser.storage.local.set({ [PROFILE_KEY]: profile });
}

const SNAPSHOT_KEY = 'profile-snapshots';

/** Enough to recover from a bad import without letting storage grow forever. */
const MAX_SNAPSHOTS = 5;

export interface ProfileSnapshot {
  takenAt: number;
  reason: string;
  profile: Profile;
}

/**
 * A copy of the profile taken before something replaces it wholesale.
 *
 * A resume import, a JSON import, or a mis-click can overwrite data that took
 * real effort to curate, and export is manual — so the realistic outcome was
 * losing it. Snapshots make the destructive paths reversible, which is also
 * what makes them safe to use.
 */
export async function snapshotProfile(reason: string): Promise<void> {
  const current = await getProfile();
  const stored = await browser.storage.local.get(SNAPSHOT_KEY);
  const snapshots = ((stored[SNAPSHOT_KEY] as ProfileSnapshot[] | undefined) ?? []).slice(0, MAX_SNAPSHOTS - 1);

  await browser.storage.local.set({
    [SNAPSHOT_KEY]: [{ takenAt: Date.now(), reason, profile: current }, ...snapshots],
  });
}

export async function getSnapshots(): Promise<ProfileSnapshot[]> {
  const stored = await browser.storage.local.get(SNAPSHOT_KEY);
  return (stored[SNAPSHOT_KEY] as ProfileSnapshot[] | undefined) ?? [];
}

/**
 * Puts a snapshot back. Takes a snapshot of the current state first, so
 * restoring the wrong one is itself reversible.
 */
export async function restoreSnapshot(takenAt: number): Promise<boolean> {
  const snapshot = (await getSnapshots()).find((s) => s.takenAt === takenAt);
  if (!snapshot) return false;

  await snapshotProfile('before restoring an earlier version');
  await setProfile(applyProfileDefaults(snapshot.profile));
  return true;
}
