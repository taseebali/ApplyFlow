import { useEffect, useState } from 'react';
import { getTabState, patchTabState, type TabState } from '@/lib/tab-state';
import { useActiveTab } from '@/components/useActiveTab';

/**
 * Binds the panel to whichever tab is in front, and follows that tab's stored
 * state. The panel is shared across tabs while each application lives in its
 * own, so results have to come from the tab rather than from component state:
 * switching away and back must show the same application's progress, and a
 * draft running in the background must keep updating while the panel is
 * showing something else.
 */
export function useTabState() {
  const tabId = useActiveTab();
  const [state, setState] = useState<TabState>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (tabId === null) return;

    void getTabState(tabId).then((stored) => {
      if (cancelled) return;
      setState(stored);
      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [tabId]);

  // Background work writes straight to storage, so watching it is what makes
  // progress appear without the panel polling for it.
  useEffect(() => {
    if (tabId === null) return;
    const key = `tab:${tabId}`;
    const area = browser.storage.session ?? browser.storage.local;

    const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
      if (!(key in changes)) return;
      setState((changes[key]?.newValue as TabState | undefined) ?? {});
    };

    area.onChanged.addListener(onChanged);
    return () => area.onChanged.removeListener(onChanged);
  }, [tabId]);

  const patch = async (updates: Partial<TabState>) => {
    if (tabId === null) return;
    setState(await patchTabState(tabId, updates));
  };

  return { tabId, state, patch, loaded };
}
