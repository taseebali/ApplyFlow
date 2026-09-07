import { useEffect, useState } from 'react';

/**
 * Which tab the panel is looking at, kept current.
 *
 * The side panel is one document shared by every tab in the window, so nothing
 * about it resets when you switch tabs — following the switch is something the
 * panel has to do deliberately. Three components did it and three did not:
 * `App` and `useFormPlan` each read the active tab once on mount and never
 * again, so the posting, the field mirror and everything derived from them
 * stayed pinned to whichever tab was in front when the panel opened. That is
 * the panel "staying on everywhere".
 *
 * Also follows navigation within a tab, because applying to a second job in
 * the same tab is the same problem wearing different clothes.
 */
export function useActiveTab(): number | null {
  const [tabId, setTabId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bind = async () => {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!cancelled) setTabId(tab?.id ?? null);
      } catch {
        if (!cancelled) setTabId(null);
      }
    };

    void bind();

    const onActivated = () => void bind();
    // A tab that finishes loading a different page is a different application,
    // even though the tab id has not changed. `status: 'complete'` rather than
    // every update, so this does not fire on every favicon and title change.
    const onUpdated = (_id: number, change: { status?: string }) => {
      if (change.status === 'complete') void bind();
    };

    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);

    return () => {
      cancelled = true;
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return tabId;
}
