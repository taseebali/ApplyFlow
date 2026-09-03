import {
  EMPTY_PROFILE,
  textToBullets,
  type BulletEntry,
  type Profile,
  type ProjectEntry,
  type WorkHistoryEntry,
} from './schema';

const PROFILE_KEY = 'profile';

/** Backfills any top-level sections added to Profile after a user's data was last saved. */
/** A legacy entry still holding `description` instead of `bullets`. */
type MaybeLegacy<T> = T & { description?: string };

function withBullets<T extends { bullets?: BulletEntry[] }>(entry: MaybeLegacy<T>): T {
  if (entry.bullets && entry.bullets.length > 0) return entry;
  const bullets = entry.description ? textToBullets(entry.description) : [];
  const { description: _dropped, ...rest } = entry;
  return { ...(rest as T), bullets };
}

/**
 * A profile as it may exist on disk: roles and projects saved before tailoring
 * existed still carry `description` and no `bullets`. Naming that here keeps
 * the migration honest rather than casting it away at the call site.
 */
export type StoredProfile = Omit<Partial<Profile>, 'workHistory' | 'projects'> & {
  workHistory?: Array<MaybeLegacy<Partial<WorkHistoryEntry>>>;
  projects?: Array<MaybeLegacy<Partial<ProjectEntry>>>;
};

export function applyProfileDefaults(stored: StoredProfile): Profile {
  return {
    contact: { ...EMPTY_PROFILE.contact, ...stored.contact },
    links: { ...EMPTY_PROFILE.links, ...stored.links },
    // Roles and projects saved before tailoring existed carry one description
    // blob. Split it rather than drop it: those sentences are the user's own
    // writing and are the seed for everything the bank generates.
    workHistory: (stored.workHistory ?? EMPTY_PROFILE.workHistory).map(withBullets) as Profile['workHistory'],
    // Entries saved before `current` existed default to finished, which is
    // the safe reading: it never claims someone is still studying.
    education: (stored.education ?? EMPTY_PROFILE.education).map((entry) => ({
      ...entry,
      current: entry.current ?? false,
    })),
    projects: (stored.projects ?? EMPTY_PROFILE.projects).map(withBullets) as Profile['projects'],
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

/**
 * `storage.local` is capped at roughly 10MB and shared by the profile,
 * snapshots, learned mappings and the model catalogue. A rejected write is
 * silent otherwise — the user would go on editing a profile that is no longer
 * being saved.
 */
export class StorageFullError extends Error {}

export async function setProfile(profile: Profile): Promise<void> {
  try {
    await browser.storage.local.set({ [PROFILE_KEY]: profile });
  } catch (err) {
    throw new StorageFullError(
      'Could not save your profile — this browser’s extension storage is full. Remove some earlier versions under Setup → Earlier versions, then try again.',
      { cause: err }
    );
  }
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
