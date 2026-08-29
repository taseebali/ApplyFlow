import { useEffect, useState } from 'react';
import { getTabState, patchTabState, type TabState } from '@/lib/tab-state';

/**
 * Binds the panel to whichever tab is in front, and follows that tab's stored
 * state. The panel is shared across tabs while each application lives in its
 * own, so results have to come from the tab rather than from component state:
 * switching away and back must show the same application's progress, and a
 * draft running in the background must keep updating while the panel is
 * showing something else.
 */
export function useTabState() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [state, setState] = useState<TabState>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const bindToActiveTab = async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (cancelled || !tab?.id) return;
      setTabId(tab.id);
      setState(await getTabState(tab.id));
      setLoaded(true);
    };

    void bindToActiveTab();

    const onActivated = () => void bindToActiveTab();
    browser.tabs.onActivated.addListener(onActivated);

    return () => {
      cancelled = true;
      browser.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

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
