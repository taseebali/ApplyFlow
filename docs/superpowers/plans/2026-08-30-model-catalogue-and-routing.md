# ApplyFlow: Model Catalogue and Local Routing

## Context

Choosing a model today means leaving the extension, finding an id on
openrouter.ai, and pasting it into a free-text box. That is bad on its own, but
the real cost showed up in practice:

- **Pasted ids rot.** `deepseek/deepseek-chat-v3-0324:free` was a working free
  model recently; it is now absent from the free list and returns zero live
  endpoints. Nothing in the extension notices — it fails like any other error.
- **Free endpoints saturate.** The failure that started this was Nvidia's free
  endpoint refusing at 16/16 worker slots. Retries and OpenRouter's own
  `models` array (both shipped) help within one request, but nothing remembers
  that a model was busy a second ago, so the next question hits it again.

## Findings (verified against the live API, not assumed)

- `GET /api/v1/models` — **public, no API key required**. 396 models, 18 with a
  `:free` suffix, 21 priced at zero. Each carries `id`, `name`,
  `context_length`, `pricing`, `supported_parameters`.
- `GET /api/v1/models/{author}/{slug}/endpoints` — per-provider health:
  `status`, `uptime_last_5m`, `uptime_last_30m`, `uptime_last_1d`,
  `latency_last_30m`, `throughput_last_30m`, `context_length`. A model with no
  live provider returns `endpoints: []`, which is how a retired free model
  presents.
- `https://openrouter.ai/*` is already in `host_permissions`. No new permission
  is needed for any of this.

## Decisions

- **The catalogue is fetched without the API key.** It is a public endpoint;
  sending a credential to something that does not need one is a habit worth not
  forming.
- **No hosted routing service.** Routing runs in the extension, against the
  public health data. A server would mean the resume passing through
  infrastructure we operate, which the project has consistently refused.
- **The local router composes with OpenRouter's `models` array**, it does not
  replace it. Each attempt still hands OpenRouter a short in-request fallback
  list; the router adds memory *between* attempts.
- **`free-pool` is the default policy, with the training exposure stated at the
  point of choosing it** (decided 2026-08-30). Cost is the reason the feature
  exists; the warning has to be prominent rather than a footnote, since the
  payload includes the resume.
- **No API key in `.env`.** Vite inlines env vars into the bundle at build
  time, so a key in `.env` ships to every user of a packaged build. Keys stay
  in `chrome.storage.local`. A dev-only prefill is Phase 4.

## Non-goals

- Auto-selecting a model without the user having chosen a policy. The user
  picks a mode; the router only moves within what that mode allows.
- Bundling a hardcoded model list as a fallback for a failed fetch. A stale
  built-in list is exactly the rot this plan exists to remove — an empty
  catalogue must say "could not load, type an id" instead.

---

## Phase 1 — Model catalogue and picker

**New** `extension/lib/openrouter-catalog.ts`
- `fetchModels(): Promise<CatalogModel[]>` — normalises to
  `{ id, name, contextLength, promptPrice, completionPrice, isFree }`.
- Cached in `chrome.storage.local` under a version key with a fetch timestamp;
  24h TTL, plus an explicit refresh. The panel must not hit the network every
  time Settings opens.
- Defensive parsing: a model missing `pricing` or `context_length` is skipped,
  not allowed to throw the whole list away.

**New** `extension/lib/openrouter-catalog.test.ts` — normalisation, free
detection (`:free` suffix *and* zero price — they do not perfectly overlap),
cache expiry, malformed entries.

**Modify** `extension/components/ProfileForm.tsx`
- Replace the two free-text model inputs with a picker: a filter box, a
  "free only" toggle, and rows showing name, context length, and price.
- Keep a manual-entry escape hatch for a model the catalogue lags on.
- A "Refresh list" control, and a plain message when the fetch fails.

## Phase 2 — Availability, surfaced

**Modify** `extension/lib/openrouter-catalog.ts`
- `fetchEndpointHealth(modelId)` → `{ providers, bestUptime5m, anyLive }`.

**Modify** the picker
- A health indicator on the selected model, and an explicit warning when a
  model has no live endpoints — the retired-model case, which currently looks
  like a generic failure.
- Fetched only for the selected model, not all 396.

## Phase 3 — Local routing (the actual capacity fix)

**Modify** `extension/lib/settings.ts` — `openRouterModel: string` becomes a
selection policy:
```ts
type ModelPolicy =
  | { kind: 'single'; model: string }
  | { kind: 'list'; models: string[] }       // ordered, user's own
  | { kind: 'free-pool'; minContext: number } // any free model, health-ranked
```
Backfilled through `applySettingsDefaults` from the existing string, so nobody
loses their setting.

**New** `extension/lib/model-router.ts`
- `nextCandidates(policy, catalogue, cooldowns, now): string[]` — a **pure
  function**, which is where the test weight goes. No network, no storage.
- Cooldowns live in `chrome.storage.session`: a model that fails transiently is
  parked for ~5 minutes and skipped. This is the piece OpenRouter's `models`
  array cannot do, because it has no memory between requests.
- `free-pool` ranks by `uptime_last_5m`, filtered by `minContext` — resume
  parsing needs real context, and some free models are tiny.

**Modify** `extension/lib/llm-client.ts`
- Ask the router for candidates; send the first as `model` and the next two as
  `models`; on a transient failure, record the cooldown and take the next
  candidate. The existing retry/backoff stays for the single-model case.

**Modify** the drafting run — report which model actually answered
(OpenRouter returns it in the response `model` field), so a run that quietly
degraded to a weaker model is visible rather than mysterious.

## Phase 4 — Dev-only key prefill (optional)

The safe form of the `.env` request.
- `.env.local` with `WXT_OPENROUTER_KEY`, read **only** behind
  `import.meta.env.DEV`, used to prefill the settings field on first run.
- `.env*` added to `.gitignore`; a release build must inline nothing.
- A build-time assertion that the production bundle contains no key-shaped
  string, so this cannot regress into a shipped credential.

---

## Risks

- **Privacy.** `free-pool` makes free providers the default path, and free
  providers may train on what is sent — which here includes the resume and work
  history. The warning belongs at the point of choosing the mode, stated
  plainly, not buried in a hint.
- **Quality variance.** Rotating across free models means answers vary in
  quality between questions in one run. The `minContext` filter helps; showing
  which model answered makes it legible.
- **Catalogue churn.** The free roster changes week to week. Nothing may be
  hardcoded against it.

## Verification

**Automated** — `nextCandidates` (ordering, cooldown skipping, exhaustion,
minContext filtering), catalogue normalisation and cache expiry, and a fetch
test that a `free-pool` run moves to the next model after a transient failure
and does not retry a cooling-off one.

**Manual, in Brave** — open Settings with no network and confirm the picker
degrades to manual entry; pick a free model and confirm the health indicator;
select a known-retired id and confirm the "no live endpoints" warning; run a
drafting pass with `free-pool` while one model is saturated and confirm it
moves on and reports which model answered.
