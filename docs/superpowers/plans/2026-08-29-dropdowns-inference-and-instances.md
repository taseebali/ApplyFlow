# ApplyFlow: Dropdowns, Inference, and Per-Tab Instances

## Context

Testing against a real Greenhouse form (Raisin) exposed that the extension
fills the easy half of an application and quietly gives up on the rest. Four
things are actually broken, and several capabilities are missing that the form
makes obviously necessary.

Two bugs were confirmed by reading the live form and our own code, not guessed:

- **"Attached" is reported without checking.** In `entrypoints/content.ts`,
  `attachDocuments` sets `result[kind] = true` as soon as it *finds* a target
  field — before the `DataTransfer` assignment happens. So the panel says
  ATTACHED whether or not the file landed. Both file inputs do exist on the
  form (`id="resume"`, `id="cover_letter"`, class `visually-hidden`), so
  matching is not the problem; verification is missing entirely.
- **Dropdowns are being sent to the AI as essay questions.** Every dropdown on
  that form is a react-select, i.e. an `input[type="text"]` with a long label.
  `detectQuestions` accepts any text input whose label is ≥15 characters, so
  "What is your work authorisation in Germany?" is treated as an open-ended
  question. This is why drafting was slow and produced nothing useful.

## What we currently send to the AI

Asked directly, so recording it here. `buildPrompt` in `lib/llm-client.ts`
sends only: the question, the job description, work history, and projects.
It does **not** send education, skills, languages, links, or location — which
is why a question like "how have you integrated AI into your studies?" has
nothing to work from. Fixed in Phase 5.

## Decisions taken

- **Dropdown matching:** deterministic first (exact → word-set → synonym
  table), then a single AI call as fallback when those miss. Free and instant
  in the common case; handles the long tail ("EU citizen" for a yes/no
  profile value) only when needed.
- **Location data:** bundle the full `country-state-city` dataset so country,
  state, and city are all dropdowns. Lazy-loaded so the weight is only paid
  when Setup is opened.
- **Per-tab instances:** drafting moves into the background service worker,
  keyed by tab. Starting a draft on one application and switching to another
  is the point of the feature; per-tab state alone would not deliver it.

## Build order

1. Phase 1 — stop reporting unverified success
2. **Phase 6 — per-tab instances + background drafting** (core architecture;
   done early so later phases are written against it once)
3. Phase 2 — dropdowns
4. Phase 3 — inference rules
5. Phase 5 — drafting context and dual backends
6. Phase 4 — profile gaps (languages, location, required fields, Notion skip)

## Non-goals

- Resume/cover-letter *generation* from `master-profile.yaml`. Scoped
  separately (see the companion note); the file is not needed for this plan.
- Auto-submitting any form. Everything stays review-then-act.

## Working style

Small, self-contained commits — each module, each wired-up piece, each fix its
own commit, so any one can be reverted alone. Plain messages, no branding, no
AI attribution. `npm run compile`, `npm run build`, `npm test` green before
each commit.

---

## Phase 1 — Stop reporting success that did not happen

Smallest and highest trust value: the tool currently lies about two things.

**Modify** `extension/entrypoints/content.ts`
- Verify after assignment: check the target `input.files` actually contains
  the file, and report per-document success on that basis.
- Return a reason when it fails ("the field rejected the file", "no upload
  field found for a cover letter"), mirroring the combobox diagnostics added
  earlier, since this cannot be tested outside a real browser.

**Modify** `extension/components/DailyView.tsx` — show the reason on the
failing document row instead of a bare ATTACHED/failed.

## Phase 2 — Dropdowns that actually land

**Modify** `extension/lib/combobox.ts`

1. **Enumerate options even when the menu DOM is unreadable.** Add a keyboard
   fallback: press ArrowDown repeatedly and read `aria-activedescendant` /
   the highlighted option's text to walk the list. Some widgets never expose
   a queryable menu, and today that is an unconditional failure.
2. **Layered matching**, in order, stopping at the first hit:
   exact → same-words-any-order (already built) → synonym table → AI.
3. **New** `extension/lib/option-synonyms.ts` — a table for the categories
   forms reuse endlessly: yes/no phrasings, availability ("immediately",
   "right away", "2 weeks' notice"), work authorisation ("EU citizen",
   "requires sponsorship"), hybrid/remote, language levels.
4. **New** `extension/lib/option-ai.ts` — `chooseOption(question, options,
   profileValue, llm)`: one small prompt returning an index or "none".
   Strictly a fallback, skipped entirely when no backend is configured, and
   defensively parsed like `parseLlmResponse` already is.

Tests: the synonym table and the matching ladder are pure and get real
coverage; the DOM driving stays browser-verified.

## Phase 3 — Common-sense inference

Questions whose answer follows from the profile should never be asked twice.

**New** `extension/lib/inference.ts` — a small ordered rule set, each rule
matching question text and deriving an answer from `Profile`:

- Currently studying (`education[].current`) → "are you enrolled at a
  university/college?" → Yes.
- Question names a city matching `contact.city` → "are you based in X?" → Yes.
- Hybrid/office-days question naming a city that matches → Yes.
- Notice period / "when could you start" → `logistics.availableFrom`.

Runs after schema matching and before a field is classed unrecognised, so it
feeds the normal fill path (including the dropdown ladder above). Each rule is
a pure function over `(questionText, profile)` returning a string or null —
directly unit-testable, which is where the test weight goes.

## Phase 4 — Profile gaps the form exposed

**Modify** `extension/lib/schema.ts`, `extension/components/ProfileForm.tsx`

- **Languages** — new `languages: Array<{ id, language, level }>` with CEFR
  levels (A1–C2, Native). Schema fields for "which languages can you work
  with" and "what is your current German level".
- **Location dropdowns** — country, state, and city from `country-state-city`,
  each narrowing the next. Lazy-import the dataset inside the section so it
  stays out of the panel's main chunk (same pattern as `pdfjs`/`mammoth` in
  `lib/resume-text.ts`).
- **Required-field marking** — mark the fields without which filling is
  useless (name, email, phone, city/country, work authorisation). Show a
  completeness indicator in Setup and a warning on the Fill card when a
  required field is empty.
- **Notion skip** — an explicit "Skip / not using Notion" control that
  disables the tracker cleanly, so the step never looks half-finished.

## Phase 5 — Drafting: right questions, right context, two backends

**Modify** `extension/lib/question-detector.ts`
- Exclude comboboxes via the existing `isCombobox` from `lib/combobox.ts`, and
  exclude anything the inference rules can answer. Only genuinely open-ended
  prose fields reach the AI.

**Modify** `extension/lib/llm-client.ts`
- `buildPrompt` gains education, languages, skills, and location — currently
  the model cannot answer a question about studies because it is never told
  about them.
- **Dual backends.** `Settings.llm` gains a fallback: OpenRouter used first,
  Ollama on failure (or the reverse if the user prefers). `runPrompt` tries
  primary, then fallback, and reports which one answered. Settings UI lets
  both be configured at once rather than being an either/or radio.

## Phase 6 — Per-tab instances with background drafting

**Sequencing note:** this is core architecture, not a nice-to-have, so it is
built *second* — immediately after Phase 1 — rather than last. Every later
phase touches `DailyView`, and building them against the current in-component
state would mean rewriting that work once this lands. Numbered 6 only because
it was specified last.

**New** `extension/lib/tab-state.ts` — per-tab panel state in
`chrome.storage.session`, keyed by tab id: fill results, attach results, draft
results.

**Modify** `extension/entrypoints/background.ts`
- Own the drafting run: the panel sends "draft for tab N", the worker does the
  LLM calls and writes progress/results into that tab's state. Work continues
  when the panel closes or the user switches tabs.
- Clean up a tab's state on close so storage does not grow forever.

**Modify** `extension/components/DailyView.tsx`
- Read and subscribe to the active tab's state rather than holding results in
  component state. Switching tabs shows that application's own results;
  returning to a tab mid-draft shows its progress, and finished answers are
  waiting.

## Verification

**Automated** (`npm test`, currently 76): new coverage for the synonym table,
the matching ladder, every inference rule, and per-tab state isolation.

**Manual, in Brave** — the parts that cannot be tested outside a browser:

1. **Attach** — run on the Raisin form; confirm the cover letter genuinely
   appears in the form, and that a deliberate failure reports a reason rather
   than a false ATTACHED.
2. **Dropdowns** — the real test. Confirm Degree, start date, work
   authorisation, Berlin-based, hybrid, and language dropdowns all take a
   value. Any that miss should now name the stage they failed at.
3. **Inference** — with "still studying" ticked and city set to Berlin,
   confirm the enrolment, Berlin, and hybrid questions answer themselves.
4. **Drafting** — confirm only the four genuine free-text questions are sent,
   not the dropdowns, and that answers reference education where relevant.
5. **Per-tab** — start drafting on one application, switch to a second tab,
   fill it, return to the first and confirm the finished drafts are there.
