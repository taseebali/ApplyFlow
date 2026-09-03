# ApplyFlow: Tailored Resume and Cover Letter Generation

## Context

The last unbuilt feature from the product review (6.3). Everything else in this
repo helps you *submit* an application faster; this is the first thing that
changes what you submit.

The brief arrived with a hard piece of evidence: a model-written resume scored
**40/100** on an ATS scorer. The faults were specific — five of seven bullets
opened with "Built", almost no numbers, generic vocabulary, visible repetition.
That score is the design input for this whole document. If what we ship writes
resumes that score 40, we have built nothing.

## What we tried first, and why it was wrong

Two designs were considered and rejected before this one. Recording them
because the reasons are the load-bearing part of the final design.

**Rejected: the model never writes; the user authors a bank of bullets and the
model only selects.** Safe — nothing can be fabricated — and it makes the
40/100 failure impossible. But it assumes an author who does not exist. Nobody
hand-writes bullets knowing a generator will consume them, and a feature that
demands an hour of writing before it does anything serves only the people who
would have written a good resume anyway.

**Rejected: generate per application.** Every application pays full generation
cost, quality is re-rolled each time, and the repetition faults recur every
time because each run has no memory of the last.

**Chosen: generate a variant bank once, ahead of any application; select from
it per application.** Generation quality is fixed once, checked once, and
repaired once. Applying becomes ranking — fast, nearly free, and deterministic
enough to enforce real constraints on.

## Decisions

**Variants are keyed on `(project × angle)`, not on job title.** Angles are
ways of framing the same work: technical depth, scale, measurable impact,
ownership, collaboration, delivery speed. A role family ("Applied ML", "Backend")
is then a *preferred mix of angles*, not its own bank. Keying on title alone has
an unbounded tail and no answer for a title we have never seen; composing from
angles always has one.

**Facts come from the user; phrasing comes from the model.** The model may
rewrite and reframe freely, but every number and claim traces to the imported
resume or to an answer the user typed. Nothing is invented. This is the one
rule that cannot bend — an invented metric on a resume is discovered in an
interview.

**Quality constraints are code, not prompt.** "Please vary your verbs" fails
silently and often. A post-selection pass that refuses two bullets sharing an
opening verb cannot. Everything the ATS scorer flagged is cheaply checkable in
plain TypeScript, and that is where it will be checked.

**Output is `.docx`.** ATS parse Word reliably and mangle typeset PDFs. Single
column, real headings, no tables or text boxes. The user can also edit it.
`docx` is ~4.6MB unpacked and lazy-loaded, like `pdfjs` already is.

**The bank is generated with one pinned model.** The free-pool router rotates
when a provider saturates, which is right for answering questions and wrong
here: a bank written by four different models reads like four different people,
which is the inconsistency the scorer punishes.

**Bank generation does not run on free models by default.** Not a rate-limit
problem — OpenRouter free is 20 rpm and 50/day, rising to 1000/day after a
one-time $10 credit purchase, and batched bank generation is roughly eight
calls. The reasons are quality consistency, and that this single payload
contains the user's entire work history, which free providers may train on.

## Non-goals

- **A hosted service.** Ruled out repeatedly and still ruled out.
- **Auto-submitting a generated document.** Review before use, as everywhere
  else in this product.
- **Depending on OmniRoute or any local gateway.** It already works through the
  existing custom OpenAI-compatible provider, and it is worth a README recipe
  as the power-user backend. Building on it would narrow the audience to people
  who did not need us.
- **Beating an ATS by keyword stuffing.** The gap analysis reports what is
  missing; it does not pad.

---

## Phase 1 — Measure the resume you already have

Ships value before any generation exists: it scores the resume you are sending
today and names what is wrong with it.

**New** `extension/lib/bullet-quality.ts` — deterministic, no LLM, no network.

```ts
export interface BulletFault {
  kind: 'verb-collision' | 'no-metric' | 'weak-opener' | 'cliche' | 'too-long' | 'passive';
  detail: string;
}
export function scoreBullet(text: string): BulletFault[];
export function scoreSection(bullets: string[]): { faults: BulletFault[]; score: number };
```

- **verb-collision** — two bullets in a section sharing an opening verb. This is
  the five-times-"Built" fault, and it is a three-line check.
- **no-metric** — no digit anywhere in the bullet.
- **weak-opener** — *Responsible for*, *Worked on*, *Helped with*, *Assisted*,
  *Leveraged*, *Utilized*.
- **cliche** — *cross-functional*, *fast-paced*, *team player*, *passionate
  about*, *proven track record*.
- **too-long** — beyond roughly two printed lines.
- **passive** — crude auxiliary-plus-participle detection; low weight, since
  the check is imprecise.

**New** `extension/lib/bullet-quality.test.ts` — the test weight goes here. Pure
functions over strings, so the corpus can be real bullets with known faults.

**Modify** `extension/lib/schema.ts` — `WorkHistoryEntry.description: string`
becomes `bullets: BulletEntry[]`, each with `text` and an optional `metric`.
Same for `ProjectEntry`. Backfilled through `applyProfileDefaults` by splitting
an existing description on line breaks, so no one loses data.

**Modify** the resume importer to populate bullets rather than one blob.

**New UI** — a quality panel in Setup listing every faulted bullet with its
fault named, so the worst three can be fixed by hand in five minutes.

## Phase 2 — The bank

**New** `extension/lib/bullet-bank.ts` — storage and shape.

```ts
export type Angle = 'technical' | 'scale' | 'impact' | 'ownership' | 'collaboration' | 'delivery';

export interface BulletVariant {
  id: string;
  sourceId: string;   // the project or role this reframes
  angle: Angle;
  text: string;
  openingVerb: string;  // precomputed, so selection can enforce variety cheaply
  hasMetric: boolean;
}
```

Held in `chrome.storage.local` alongside the profile, with a `generatedAt` and
the model used, so staleness is visible.

**New** `extension/lib/bank-generation.ts`
- One call per source item, producing all angles for it — roughly eight calls
  for a typical profile, well inside even the un-credited free daily cap.
- Strict JSON out, parsed with the same defensive approach as
  `parseLlmResponse` — a model returning prose must not lose the run.
- **Every generated variant is scored by Phase 1 before it enters the bank.**
  Anything with a weak opener or a cliché is discarded and regenerated once.
  This is the gate that makes a 40/100 bank impossible.
- Runs in the background worker with progress, like drafting: it is slow, and
  the panel must not need to stay open.

**New** the enrichment interview. While generating, note which source items have
no metric anywhere, and ask the user one targeted question each — *"You wrote
'Built a RAG system over PDFs and transcripts.' Roughly how many documents, and
what got faster?"* Their typed answer becomes fact input for a regeneration of
that item's variants. Six questions once, not six per application.

**Risk to watch:** this is front-loaded work at onboarding, which is exactly
where people abandon. It must run in the background and the product must stay
usable while it does.

## Phase 3 — Selection and assembly

**New** `extension/lib/resume-selection.ts`
- `rankVariants(jobDescription, bank, llm)` — the model returns an ordered list
  of variant ids per section. Small prompt, structured output, cheap enough for
  free models.
- `enforceConstraints(selected)` — **pure, and where quality is actually
  defended.** No two bullets in a section share an opening verb; prefer variants
  with metrics; cap bullets per role. A collision is resolved by taking the
  next-best variant with a different opener, not by asking the model again.
- Falls back to a deterministic relevance ranking when no AI backend is
  configured, so the feature degrades rather than disappears.

**New** `extension/lib/keyword-gap.ts` — no LLM. Extract required skills from the
posting, diff against the profile and bank, and report what is missing. Likely
the most useful output in the whole feature, and the cheapest.

**New** `extension/lib/docx-export.ts` — lazy-loaded `docx`. Single column, real
headings, no tables.

**Modify** `extension/lib/document-store.ts` — the folder handle is opened
`{ mode: 'read' }`; writing generated files needs `readwrite` and a fresh
permission prompt. Once written there, the existing attach path finds them with
no further work.

## Phase 4 — Cover letter

The one place the model genuinely writes. Reuses the hardened prompt work
already in `llm-client.ts` — fenced untrusted page text, no invented employer
facts, no volunteered weaknesses — plus:

- a banned-opener list (*I am writing to express my interest* is on it)
- sentence-opener diversity, checked with the Phase 1 machinery
- a hard length cap
- the existing anti-repetition context, so it does not restate the resume

Worth a good model. Cents per application.

## Phase 5 — Close the loop

**The master must maintain itself.** Curating it as a separate chore is the
thing nobody sustains.

- A full-tab review page — a new WXT entrypoint, because reviewing a resume in
  a 400px side panel is miserable and nothing should be exported unreviewed.
- Every edit made there is offered back to the bank: *"Keep this improved
  wording?"* The bank gets better as a byproduct of applying.
- Re-score on export, so the document's own faults are visible before it leaves
  — not after an external scorer finds them.

---

## Assumptions this bakes in

Named because they are what will hurt when this scales.

1. **The imported resume contains the facts.** Load-bearing and weakest.
   Everything downstream inherits whatever the import found. The enrichment
   interview is the mitigation and it is only partial.
2. **A variant generated for one company transfers to another.** Mostly true
   within a family; the per-application re-rank absorbs the rest.
3. **The bank goes stale.** A finished project or a new job invalidates it
   silently. Needs an explicit regeneration trigger and a visible `generatedAt`.
4. **Front-loaded cost lands at onboarding**, where churn is highest.
5. **The resume stops being one canonical document.** Every claim stays true,
   but the artefact varies per posting. That is tailoring taken further than
   most people take it, and it should be a deliberate choice rather than
   something we drift into — particularly if this ships to other people.

## Cost

- Bank generation: roughly eight calls, tens of thousands of output tokens,
  once. Fractions of a cent on a cheap model; under a dollar on a good one.
- Per application: ranking plus a cover letter. Effectively nothing.
- Scorer and gap analysis: free, no model.

The expensive-looking part of this feature is the part that costs nothing.

## Verification

**Automated** — the fixture-corpus philosophy applied to prose. `scoreBullet`
and `enforceConstraints` are pure and get real coverage: a section of seven
bullets all opening with "Built" must come back with six collisions; constraint
enforcement must never return two colliding bullets; a bank entry with a weak
opener must never survive the gate.

**A quality baseline, like the form corpus.** Score a real resume, record the
number, and fail the suite if it drops. The 40/100 becomes a number that can go
up.

**Manual** — generate a bank from a real imported resume and read all of it.
Then generate one application's resume and put it through the same external ATS
scorer that produced the 40. That number is the acceptance test for this
feature, and nothing else substitutes for it.
