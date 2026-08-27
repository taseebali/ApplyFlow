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
