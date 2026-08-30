# ApplyFlow: Whole-Product Review and Improvement Plan

> **Status: complete except 6.3, which is scoped as its own project (2026-08-31).**
> What shipped, and what deliberately did not, is recorded at the end under
> *Outcome*.

## How this was assessed

Findings below are grounded in the built output and the source, not in
impressions. Where a claim is checkable, the check is named. Where something is
unknown, it is marked unknown rather than guessed at — which matters here,
because the dominant failure pattern in this project has been confident claims
about behaviour that was never exercised in a browser.

## The honest summary

ApplyFlow works well for one person, on the forms that person happens to have
opened. The engineering underneath is solid — 244 tests, typed end to end,
careful about secrets, clear separation between fill, draft, attach, and track.
The gap is not code quality. It is that **almost nothing about real-world fill
accuracy is measured, and several common form shapes are structurally
unsupported.** Everything in Tier 1 follows from that.

---

# Tier 1 — The product may silently not work

## 1.1 Forms inside iframes are completely invisible

**Evidence:** `content_scripts` in the built manifest is
`[{"matches":["<all_urls>"],"js":["content-scripts/content.js"]}]` — no
`all_frames`. A grep for `iframe`, `contentDocument`, or `frames` across
`lib/` and `entrypoints/` returns nothing.

**Why it matters:** Greenhouse, Lever, SmartRecruiters and Workday are
routinely *embedded* into a company's own careers page in an iframe. On those
pages the content script runs only in the top document, finds no form, and
reports "0 filled" — indistinguishable from a page we do not understand. The
user cannot tell a bug from an unsupported site.

This is plausibly the largest coverage hole in the product, and it is invisible
precisely because it fails quietly.

**Work:**
- `all_frames: true`, plus `match_about_blank` for the srcdoc case.
- Frame-aware messaging. Today `tabs.sendMessage(tabId, …)` broadcasts to every
  frame and takes whichever reply arrives first — with several frames that is a
  race, not a fix. Enumerate frames (`webNavigation.getAllFrames`, which needs
  the `webNavigation` permission) or have each frame self-report whether it
  holds a fillable form, then address the winner by `frameId`.
- Aggregate results across frames so "12 filled" means the whole application.
- The panel must say *which* frame it filled when more than one qualifies.

**Risk:** running in every frame means running in ad and tracker iframes.
Mitigate by bailing out early in any frame with no form-like content, and never
attaching observers in a frame we are not filling.

## 1.2 No regression corpus: accuracy is unmeasured

**Evidence:** 22 test files, all unit tests over our own functions. `find` for
`*.html` outside the build output returns only the side panel's own template —
there is not a single saved real form.

**Why it matters:** this is the meta-problem behind most of this project's
history. Fixes have shipped on reasoning rather than evidence, and the user has
repeatedly been the one to discover they did not work. Unit tests over
`matchFields` prove the function behaves as written; they say nothing about
whether a Greenhouse form fills.

**Work:**
- A `fixtures/forms/` corpus: saved DOM snapshots of real application pages
  (Greenhouse, Lever, Workday, Personio, SmartRecruiters, join.com, Ashby), each
  with an `expected.json` naming the fields that *should* match and to what.
- A harness that loads each fixture into jsdom, runs the real matcher and
  question detector, and reports **matched / missed / wrongly-matched** per
  fixture.
- Fail the suite on regression, not on absolute score. The number starts where
  it starts; what matters is that it never silently drops.
- Scrub PII from fixtures on capture — these are real pages, and some were
  reached while logged in.

**This is the highest-leverage item in the document.** Everything else in Tier 1
becomes verifiable once it exists, and unverifiable until it does.

## 1.3 Non-English forms are barely supported

**Evidence:** across ~50 schema fields, exactly two German aliases exist
(`vorname`, `nachname`, in `lib/schema.ts`). `document-matcher.ts` has none.

**Why it matters:** the primary user applies to German employers. A German
form currently matches first and last name and then falls off a cliff — no
`E-Mail`, `Telefon`, `Anschrift`, `Wohnort`, `Land`, `Verfügbar ab`,
`Arbeitserlaubnis`, `Lebenslauf`, `Anschreiben`. The user has already hit this
once (`Vorname`/`Nachname` in a single field) and it was patched narrowly.

**Work:**
- Complete German aliases across every schema field and both document kinds.
- Structure aliases as `{ en: [...], de: [...] }` so adding French, Spanish, or
  Dutch is data rather than surgery.
- Normalise umlauts and ß on both sides of the comparison (`ä`→`a`, `ß`→`ss`),
  since forms are inconsistent about them.
- Extend `option-synonyms.ts` to German dropdown values (`Ja`/`Nein`,
  `Sofort`, `Nach Vereinbarung`).
- Fixtures for at least two German forms, per 1.2.

---

# Tier 2 — Trust in the core action

## 2.1 Fill is irreversible

**Evidence:** grep for `undo`, `snapshot`, `revert` across `lib/` and
`components/` finds one unrelated comment.

**Why it matters:** the project's stated invariant is that nothing is written
without explicit user action. That holds for the *first* keystroke and then
stops: one click changes thirty fields at once, and if any of them are wrong the
only remedy is to find and fix them by hand — on a live application, possibly
one that autosaves.

**Work:**
- Capture each target's prior value before writing, keep it in tab state, and
  offer **Undo fill** on the Fill card until the page changes.
- A dry-run mode that reports what *would* be written, per field, without
  writing — the natural companion to 1.2's corpus.
- Show what was changed, not just how many.

## 2.2 Written values are never validated against the form's own rules

**Why it matters:** we write a phone number, a date, a postcode in *our* format.
The form may demand its own (`pattern`, `type="tel"`, `inputmode`, a date
picker's expected string). The user finds out at submit, and the error points at
a field they did not type into.

**Work:**
- Read `pattern`, `type`, `min`/`max`, `maxlength` and adapt the value where the
  mapping is unambiguous (date reformatting, phone with/without country code).
- After writing, check `element.validity` and report per-field failures in the
  panel instead of counting the field as filled.
- Count "written but invalid" separately from "filled" — currently they are the
  same number, which overstates success.

---

# Tier 3 — Data safety

## 3.1 The profile has no history

A resume import, a JSON import, or a mis-click can overwrite carefully curated
data. Import has a review screen; nothing else does, and there is no restore.

**Work:** snapshot the profile before any bulk write, keep the last few in
`storage.local`, and offer restore in Setup. Cheap, and it removes the fear
that makes people avoid the import feature that exists to save them typing.

## 3.2 Storage limits are unbounded and undeclared

`permissions` is `['storage','sidePanel']` — no `unlimitedStorage`, so
`storage.local` is capped at ~10MB. Profile, field overrides, and the model
catalogue all share it. Nothing currently monitors or bounds that.

**Work:** bound the catalogue cache explicitly, and surface a clear error if a
write is rejected rather than failing silently. Request `unlimitedStorage` only
if something genuinely needs it — an extra permission is a review cost.

---

# Tier 4 — Footprint

## 4.1 An 8.7MB chunk for three dropdowns

**Evidence:** `chunks/lib-BwuqqD7B.js` is 8,716,461 bytes — 77% of the entire
11.35MB extension. It is the `country-state-city` dataset, pulled in for the
country/state/city pickers.

**This one is mine.** I chose the library for correctness and lazy-loaded it,
and treated "not in the main chunk" as sufficient. It is not: the user still
downloads it on install and parses it the moment they open the contact section,
for a feature worth a few kilobytes.

**Work:** ship a ~250-entry country list and ISO subdivisions (tens of KB), and
either drop the city dropdown to a free-text field with suggestions, or fetch
cities on demand for the selected country only. Expect the extension to fall
from ~11.3MB to under 3MB.

---

# Tier 5 — Distribution reality

## 5.1 The permission surface will draw store scrutiny

`optional_host_permissions: ['https://*/*','http://*/*']` — **also mine**, added
for custom OpenAI-compatible endpoints. Optional or not, "read and change all
your data on all websites" is what a reviewer and a user will read.

**Work:** drop the wildcard and ask for the specific origin the user typed, at
the moment they type it (`permissions.request` accepts a concrete origin). The
wildcard was never necessary; it was the lazy shape.

`<all_urls>` on the content script is harder to avoid — filling any job site is
the product — but it needs a written justification for review, and the store
listing must say plainly what is sent where.

## 5.2 The Firefox target is advertised but partly broken

`package.json` exposes `build:firefox` and `zip:firefox`. The documents feature
depends on the File System Access API, which Firefox does not implement, and
`chrome.sidePanel` differs. Shipping a Firefox build today means shipping one
where document attach silently does nothing.

**Work:** either feature-detect and degrade honestly on Firefox (file picker
instead of a folder handle), or remove the Firefox scripts until it is real.

## 5.3 Store submission is unstarted

Needed: privacy policy URL, per-permission justifications, screenshots, a
listing that states plainly that data stays local except for the two calls the
user triggers, and a support contact. None exist.

---

# Tier 6 — The job-seeking workflow, not the extension

## 6.1 Nothing tells the user whether this is working

No record of applications sent through the tool, time saved, or fill accuracy
over time. The Notion tracker holds outcomes but nothing closes the loop.

**Work:** a local history — application, date, fields filled, questions drafted,
whether documents attached. Enough to answer "is this helping?" and to find the
sites that consistently fail.

## 6.2 Tracking requires Notion

Notion can now be skipped cleanly, but skipping means no tracking at all. A
local tracker with CSV export would serve everyone else.

## 6.3 Resume and cover-letter tailoring is still unbuilt

The feature the user asked about and deferred. With the provider layer, the
prompt hardening, and the profile in place, the remaining work is a
`master-profile.yaml` (or JSON Resume) plus a render step. This is the largest
unbuilt thing in the product and the one most likely to change outcomes rather
than save minutes.

## 6.4 Drafting has no cost visibility

No token or spend accounting, and saved answers match only exactly (via
`normalizeQuestion`). Near-duplicate questions across employers — and there are
many — pay for a model call every time.

**Work:** show tokens and estimated cost per run; fuzzy-match saved answers with
a similarity threshold and a confirmation before reuse.

---

# Suggested order

The sequencing is deliberate: measurement first, because it makes everything
after it verifiable.

1. **1.2 regression corpus** — turns accuracy into a number.
2. **1.1 iframes** — the biggest coverage gap; now measurable.
3. **1.3 German** — the primary user's daily case; now measurable.
4. **2.1 undo + dry run** — makes the core action safe to trust.
5. **4.1 bundle** — a large, contained win.
6. **5.1 permissions** — before any store submission.
7. **2.2 validation**, **3.1 snapshots** — hardening.
8. **6.x** — product surface, once the foundation is measured and safe.

# What is deliberately not proposed

- **A backend.** Repeatedly ruled out, and nothing here needs one.
- **Auto-submit.** The product's value depends on the user reviewing before
  anything is sent.
- **More ATS-specific special cases** before 1.2 exists. Without measurement,
  each one is a guess that may regress two others.

# Standing risk

Everything shipped in the last several sessions — dropdown handling, inference,
per-tab state, the model catalogue, routing, the provider layer, the prompt
rewrite — has been verified by types, unit tests, and a build. **None of it has
been exercised in a browser.** Item 1.2 is the structural answer; until then,
treat each of those as plausible rather than proven.


---

# Outcome (2026-08-31)

## Done

| Item | Result |
|---|---|
| 1.2 Regression corpus | `fixtures/forms/` plus a harness that fails on regression. Seeded with a real GitLab Greenhouse form captured post-hydration. **11/11 matched, 0 wrong**, printed on every test run. |
| 1.1 Iframes | `all_frames`, frames self-register with the worker (no new permission — `sender.frameId` suffices), panel addresses them individually and merges results. |
| 1.3 Non-English labels | Accent folding in `normalizeText` — without it every German alias was unmatchable. German aliases across 27 fields, plus document names and `Ja`/`Nein`/`Sofort` dropdown values. |
| 2.1 Undo | Every write journalled at `setNativeValue`, the one choke point. "Undo fill" restores the pre-fill value per frame. |
| 2.2 Validation | Values adapted to the field's declared type before writing, then checked with the browser's own constraint validation. "Rejected by the form" is now counted separately from "filled". |
| 3.1 Snapshots | Profile copied before any import; five kept; restore in Setup, itself reversible. |
| 3.2 Storage | Catalogue cache write and profile write both handle a full quota instead of failing silently. |
| 4.1 Bundle | **11.35MB → 2.74MB.** The 8.7MB `country-state-city` dependency replaced with 94KB of generated data; city became free text, which is what forms use anyway. |
| 5.1 Permissions | Wildcard narrowed to `https://*/*` — and `http` refused outright, since a custom endpoint carries an API key. |
| 5.2 Firefox | Documents folder feature-detects and explains itself instead of showing a dead button. |
| 5.3 Store material | `docs/store-listing.md` — permission justifications, single purpose, data disclosures, checklist. |
| 6.1 / 6.2 Local tracking | `lib/application-log.ts` records every fill, with stats and CSV export. Tracking no longer requires Notion. |
| 6.4 Answer reuse | Near-duplicate questions surface the saved answer as a suggestion showing both questions. |
| 6.4 Cost visibility | Token usage read from all four provider dialects, priced from the catalogue, shown per drafting run. A run that silently moved onto a paid model is now visible. |
| 1.1 (finish) | `frameCount` was stored but never displayed; the Fill card now says "across N frames". |
| 1.2 (finish) | Second fixture: a real German Personio form. **5/5 matched.** |

## Bugs found by this work, not predicted by it

- **Short aliases matched inside words.** The German alias `ort` matched
  "imp**ort**ant" and claimed a question that should have gone to drafting.
  Caught by the corpus on its second day. Single-word aliases now match on word
  boundaries.
- **A page-supplied `pattern` could throw out of the whole fill.** The first
  `new RegExp` in the phone adaptation sat outside its `try`.
- **Honeypot fields were fillable.** Found while fixing the reCAPTCHA
  detection: hidden decoys with ordinary names like `email` would have been
  filled, silently binning the application.
- **A salary field was being sent to the AI.** The German fixture caught
  "Gehaltsvorstellung" going to drafting, where a model would invent a salary
  figure for a real application. A question needs to be a sentence, not just a
  long word.
- **`input` with no `type` attribute was invisible to drafting.** The selector
  was `input[type="text"]`, which matches only a literal attribute, so the very
  common untyped input never reached question detection at all.

## Not done

- **6.3 Resume and cover-letter tailoring** — the only remaining item. Genuinely project-sized — a
  `master-profile.yaml`, a render pipeline, and a document format. It belongs
  in its own plan, not as a trailing item in this one.
- **A dry-run preview** (part of 2.1) — dropped deliberately. Undo makes a
  wrong fill recoverable, which addresses the risk; a preview adds a second
  code path through the filler for less benefit.
- **Aliases were appended to the existing flat arrays** rather than
  restructured as `{ en, de }`. Matching is identical; adding a third language
  is messier than the plan intended. Noted rather than hidden.

## Standing risk, unchanged

Almost none of this has been exercised in a browser. The corpus measures
*matching*, not *filling* — it cannot exercise the native-setter write path,
react-select interaction, file attach, cross-frame messaging, or any provider
call. Those remain reasoned rather than proven, and the next most valuable
thing anyone can do is load the built extension and walk one real application
end to end.
