/**
 * Opening the dashboard.
 *
 * One place rather than a `browser.tabs.create` at each call site: the path is
 * a public/ file that WXT does not know about, so every caller would otherwise
 * repeat the same cast, and an existing dashboard tab would be duplicated
 * rather than raised.
 */
const PATH = '/dashboard/index.html';

export async function openDashboard(): Promise<void> {
  // WXT types getURL against the entrypoints it compiles. The dashboard is
  // copied into public/ by scripts/bundle-dashboard.mjs and is served all the
  // same, so the path is asserted rather than inferred.
  const url = browser.runtime.getURL(PATH as '/sidepanel.html');

  /*
   * Reuse the tab if one is already open, if we are allowed to look.
   *
   * Querying by URL needs the "tabs" permission, which this extension does
   * without on purpose — it reads to a reviewer as "read your browsing
   * history" and buys nothing else here. Without it the filter simply matches
   * nothing, and on some builds it throws, so raising an existing tab is a
   * nicety attempted and never depended on. A second dashboard tab is a far
   * smaller problem than a button that does nothing.
   */
  try {
    const existing = await browser.tabs.query({ url });
    const open = existing.find((tab) => tab.id !== undefined);
    if (open?.id !== undefined) {
      await browser.tabs.update(open.id, { active: true });
      if (open.windowId !== undefined) await browser.windows.update(open.windowId, { focused: true });
      return;
    }
  } catch {
    // Not permitted to look. Open a new one.
  }

  await browser.tabs.create({ url });
}
