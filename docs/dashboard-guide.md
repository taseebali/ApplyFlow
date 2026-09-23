# The dashboard

Every application ApplyFlow has filled, with the posting, the match, and both
documents exactly as they were sent.

It is a page inside the extension — `chrome-extension://<id>/dashboard/index.html`
— not a website. Nothing is hosted, nothing is deployed, and no page outside
the extension can reach your applications, because the extension answers no
outside page at all.

## Opening it

The dashboard icon in the panel header, next to the gear. That is the whole of
it, in every build.

The address is stable across rebuilds, because the extension ID is pinned by
the `key` in `extension/wxt.config.ts`, so it can be bookmarked.

## How it is built

`dashboard/` is a separate Vite project. `extension/scripts/bundle-dashboard.mjs`
builds it and copies the output into `extension/public/dashboard/`, and every
`npm run build`, `build:firefox`, `zip` and `zip:firefox` runs that first. The
copied directory is generated and gitignored.

Working on it:

```bash
cd extension
npm run bundle:dashboard   # rebuild just the dashboard
npm run build              # or the whole extension, which does it too
```

Then reload the extension at `chrome://extensions` and reopen the tab.

`cd dashboard && npm run dev` still serves it at localhost:5174, which is
useful for laying out the page — but it cannot reach the extension from there
and will say so. That is not a misconfiguration to fix; it is the boundary.

## What crosses the boundary

The dashboard holds nothing. It asks the extension for records over
`chrome.runtime.sendMessage` and renders them, so opening it is a read of
IndexedDB on this machine and not a network request of any kind.

`extension/lib/dashboard-bridge.ts` is that boundary, in both directions:

- **Out:** `toTransferable` assembles the response field by field, never by
  spreading a record. A field added tomorrow cannot leak by being forgotten.
- **In:** `readProperties` accepts six fields — status, priority, tags, next
  action, due date, salary — and nothing else. It caps every length, folds
  duplicate tags, strips control characters, and refuses a non-finite date. A
  patch naming `resume` or `filledCount` writes nothing: what actually went out
  is the extension's record of it.

`entrypoints/background.ts` answers only messages carrying `__dashboard`, from
a sender with our extension ID, no `sender.tab`, and a URL inside the
extension. A content script always carries `sender.tab`, so a web page cannot
dress itself up as the dashboard.

Worth confirming after a change, from the dashboard's own devtools:

```js
chrome.runtime.sendMessage({ type: 'set-properties', id: '<a real id>', properties: { filledCount: 9999 }, __dashboard: true })
```

Expected: `{ok: false, error: 'Nothing valid to write.'}`.

## Why it is not hosted

It was, in design if never in fact, and the hosting is what made it dangerous.

A hosted dashboard needs `externally_connectable` in the manifest and a
matching origin allowlist in the bridge. A listed origin can read every
application — job descriptions, match scores, both `.docx` files — on every
machine the extension is installed on. The allowlist once named
`applyflow-dashboard.vercel.app` before anything had been deployed there, and
Vercel subdomains are first-come-first-served: anyone could have registered
that name and been trusted by every installed copy.

The hosting also bought nothing. The dashboard shows nothing without the
extension, so a link to it was never worth sending. And it could not work in a
release build at all, which is the thing that finally settled it — a dashboard
only developers can open is not a feature.

Both the manifest entry and the allowlist are gone. There is no external
message surface left to misconfigure.

## Keeping the two projects in step

`dashboard/` and `extension/` are separate npm projects, so neither can import
the other. The transfer types and `wordingOutcomes` are copied into
`dashboard/src/bridge.ts`, and the design tokens into
`dashboard/src/tokens.css`.

Copies drift. `npm run check:mirror` in `dashboard/` compares the member names
of every shared shape against the extension's and fails when they disagree; CI
runs it on every push. If it fails, both copies need the same change — it is
telling you one of them was forgotten, not that the check is wrong.
