# Running the dashboard

The dashboard is a static page that holds no data. Every application it shows
lives in the extension's IndexedDB on your machine; the page asks for records
over `chrome.runtime.sendMessage` and renders them. Open it in a browser without
ApplyFlow installed and it correctly shows nothing, because there is nothing
there to show.

That is why it can be a public URL with none of your data on it — and it is also
why hosting is optional. See "Do we even need Vercel?" at the end.

---

## 1. Run it locally

Nothing is published. This is the loop to use while working on it.

**Start the dashboard.**

```bash
cd dashboard
npm install
npx vite
```

It serves on `http://localhost:5174`. The port is fixed (`strictPort: true`) and
must stay 5174 — the extension's allowlist names that exact origin, so a
different port is refused.

**Build and load the extension in development mode.**

```bash
cd extension
npm run dev
```

That is WXT's dev server. It writes `extension/.output/chrome-mv3-dev` and opens
a browser with it already loaded; leave it running and it rebuilds on every
edit.

Development mode is not optional here. A release build deliberately contains no
`externally_connectable` and an empty origin allowlist, so the dashboard cannot
reach it. Only the dev build answers.

To load it by hand instead (into your own Brave profile, with your real
history): `brave://extensions` → Developer mode on → **Load unpacked** → select
`extension/.output/chrome-mv3-dev`.

**Check the extension ID matches.**

Copy the ID shown under ApplyFlow on that page and compare it to `EXTENSION_ID`
in `dashboard/src/bridge.ts`. It should be:

```
jlfojkgndajebhpbcegdimapokhjpdik
```

That ID is pinned by the `key` in `extension/wxt.config.ts`, so it stays the same
across rebuilds — but only if `applyflow-extension.pem` is present at the repo
root. That file is gitignored and exists only on the machine that generated it.
On a fresh clone the ID will differ; paste the real one into `bridge.ts`.

**Open `http://localhost:5174`.**

You should see either your applications or "Nothing applied for yet." If you see
"ApplyFlow is not installed in this browser", the ID is wrong or you loaded the
production build.

**Put a real application in it.** The dashboard only shows what the extension has
recorded, and a record is created when you fill a form:

1. Open a job posting, open the panel, fill the application.
2. Tailor a resume and a cover letter, and save from the review tab.
3. Reload the dashboard. The application is there with both documents.

---

## 2. Deploy it to Vercel

Only after the local loop works.

**Deploy.**

```bash
cd dashboard
npx vercel --prod
```

When it asks for the project root, answer `dashboard`. Vercel reads
`dashboard/vercel.json` for the rest.

**Note the real URL.** Vercel assigns `applyflow-dashboard.vercel.app` only if
that name is free; otherwise you get something else. Whatever it gives you is
the origin, and it has to be written into **four** places, which must agree:

| File | What to change |
|---|---|
| `extension/lib/dashboard-bridge.ts` | `ALLOWED_ORIGINS` is `import.meta.env.DEV ? [localhost] : []` — a release build allows nothing. Put the deployed origin in the non-DEV half. |
| `extension/lib/dashboard-bridge.test.ts` | the test asserting which origins are refused |
| `extension/wxt.config.ts` | add `https://<host>/*` to `externally_connectable.matches` |
| `dashboard/src/bridge.ts` | nothing — the page does not need its own origin |

**Why all four.** `externally_connectable` decides which pages Chrome will let
message the extension at all. `ALLOWED_ORIGINS` is a second check inside the
message handler. Both exist so that a mistake in one is not the only thing
standing between a web page and your application history.

**Then rebuild and reload:**

```bash
cd extension && npm run build
```

Load `extension/.output/chrome-mv3` unpacked and open the deployed URL.

### The security rule, stated once

**Never add an origin you have not actually deployed.**

The allowlist previously named `applyflow-dashboard.vercel.app` before anything
was deployed there. Vercel subdomains are first-come-first-served: anyone could
have registered that name and had a page already trusted by every installed copy
of the extension, able to read every job description, match score and `.docx`
file it holds. Deploy first, then add the host.

The comment at `ALLOWED_ORIGINS` says this. Do not remove it.

### Checking the boundary after deploying

Open the deployed dashboard, open dev tools, and run:

```js
chrome.runtime.sendMessage('jlfojkgndajebhpbcegdimapokhjpdik', { type: 'read-settings' })
```

Expected: `{ok: false, error: 'Unknown request.'}`. If that ever returns
settings, an API key, or profile data, stop and fix it before using the
dashboard anywhere.

The bridge accepts exactly three requests — `list`, `get`, and `set-status` —
and `set-status` is the only write. Everything returned is assembled field by
field from the record, never spread, so a field added to the record tomorrow
cannot leak by being forgotten.

---

## 3. Do we even need Vercel?

Short answer: no, and there is a case for not using it.

The dashboard is a Vite app that talks to the extension. Nothing about it needs a
web host — it could be an **extension page**, exactly like the review tab, opened
at `chrome-extension://<id>/dashboard.html`. That would mean:

- no deploy, no hosting, no URL to keep alive
- no `externally_connectable` at all, so the entire external-message surface —
  the origin allowlist, the two gates, the risk in the section above — stops
  existing
- it works offline and in a release build, which the hosted version currently
  does not
- the extension and the dashboard version can never drift apart, because they
  ship together

What you lose: a link you can send someone, and the ability to open it on a
device that does not have the extension. Given the dashboard shows nothing
without the extension anyway, that second one is not a real loss.

**The work to add it** is small, because the app already exists: a new
`extension/entrypoints/dashboard/` entrypoint that mounts the same components,
with `bridge.ts` swapped for direct calls to `application-db.ts` — no messaging
at all, since an extension page can read its own IndexedDB. The `dashboard/`
project stays as the hosted option for anyone who wants it.

Doing both is reasonable. Doing only the extension page is simpler and safer, and
would let the `externally_connectable` entry be deleted outright.
