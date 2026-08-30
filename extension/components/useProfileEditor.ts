import { useEffect, useState } from 'react';
import { EMPTY_PROFILE, isProfile, type Profile } from '@/lib/schema';
import { getProfile, setProfile, snapshotProfile } from '@/lib/storage';

type SaveState = 'idle' | 'saved';

/** Shared load/save/export/import logic for the profile-editing UI (used by both the side panel and options page). */
export function useProfileEditor() {
  const [profile, setProfileState] = useState<Profile>(EMPTY_PROFILE);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    getProfile().then((p) => {
      setProfileState(p);
      setLoaded(true);
    });
  }, []);

  const save = async () => {
    await setProfile(profile);
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 1500);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'autofiller-profile.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!isProfile(parsed)) {
        setImportError('That file does not match the expected profile format.');
        return;
      }
      // A JSON import replaces everything. Snapshot first so a wrong file is
      // recoverable rather than final.
      await snapshotProfile('before importing a profile file');
      setProfileState(parsed);
      setImportError(null);
    } catch {
      setImportError('Could not read that file as JSON.');
    }
  };

  return {
    profile,
    setProfile: setProfileState,
    loaded,
    saveState,
    save,
    exportJson,
    importFile,
    importError,
    clearImportError: () => setImportError(null),
  };
}
