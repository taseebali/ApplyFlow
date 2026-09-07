import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { jobUrlVerdict } from '@/lib/job-urls';
import { useStoredTheme } from '@/components/ThemeControl';
import '@/assets/base.css';
import './blocked.css';

/**
 * What the toolbar button does where the panel may not open.
 *
 * The panel is per-tab now, so on a page that is not a job application there is
 * nothing for it to show and Chrome would simply ignore the click — a dead
 * button, which reads as a bug. A popup takes precedence over the side panel
 * on click, so this is what the same button does instead: says where it does
 * work, and gets out of the way.
 */
function Blocked() {
  const [site, setSite] = useState<string | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  useStoredTheme();

  useEffect(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      setTabId(tab?.id ?? null);
      // `tab.url` is only populated with the "tabs" permission, which this
      // extension does without. Naming the site is a nicety; not naming it
      // costs a word, and asking to read every tab's address to get that word
      // is not a trade worth making.
      setSite(tab?.url ? jobUrlVerdict(tab.url).site : null);
    });
  }, []);

  /*
   * Detection is a guess about a URL, and a posting it fails to recognise
   * would otherwise be a panel that cannot be opened at all — the feature
   * simply not working, with no way through. This is that way through. It
   * enables the panel for this tab only, so the answer sticks for the
   * application being worked on and nowhere else.
   */
  const openAnyway = async () => {
    if (tabId === null) return;
    await browser.sidePanel?.setOptions({ tabId, path: 'sidepanel.html', enabled: true });
    await browser.action?.setPopup({ tabId, popup: '' });
    // Must be called in the click that the user actually made: Chrome requires
    // a gesture to open the panel, and an await after this point loses it.
    await browser.sidePanel?.open({ tabId });
    window.close();
  };

  return (
    <main className="blocked">
      <p className="blocked-mark">ApplyFlow</p>
      <h1>Not a job application</h1>
      <p className="blocked-site">
        {site ? (
          <>
            Nothing to fill on <strong>{site}</strong>.
          </>
        ) : (
          'Nothing to fill on this page.'
        )}
      </p>
      <p className="hint">
        The panel opens on a job posting or application form — Greenhouse, Ashby, Lever, Personio, Workday, or a
        company's own careers page. Each tab keeps its own application, so a second job in a second tab starts
        clean.
      </p>
      <button type="button" className="btn" onClick={() => void openAnyway()}>
        Open here anyway
      </button>
      <p className="hint">
        If this <em>is</em> a posting and it was not recognised, this opens the panel for this tab.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Blocked />
  </StrictMode>
);
