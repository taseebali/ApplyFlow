<div align="center">

<img src="extension/public/icon/128.png" alt="" width="88" height="88">

# ApplyFlow

**Fill job applications from a profile that never leaves your machine.**

Autofill, document attach, AI drafting and a dashboard of everything you have sent —
in the side panel, next to the form you are filling.

[![CI](https://github.com/jordanavery/ApplyFlow-autofiller/actions/workflows/ci.yml/badge.svg)](https://github.com/jordanavery/ApplyFlow-autofiller/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/applyflow?color=9e3389)](https://www.npmjs.com/package/applyflow)
[![License](https://img.shields.io/badge/license-MIT-black)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-black)](extension/wxt.config.ts)

</div>

---

```bash
npx applyflow
```

Unpacks the built extension and prints where. Then: `chrome://extensions` →
**Developer mode** → **Load unpacked** → pick that folder.

> Chrome does not let a script add an extension to your browser unless it came
> from the Web Store. That refusal is doing its job, so those four clicks are
> yours to make — whether you use npm or the
> [release zip](https://github.com/jordanavery/ApplyFlow-autofiller/releases).

Click the toolbar icon to open the panel. With no profile saved it walks you
through a setup you can skip any step of; after that it opens on a daily view
of three actions — **Fill this page**, **Attach documents**, **Draft answers**.

---

## What it does

**Reads your resume, once.** Import a PDF, `.docx` or plain text instead of
typing everything. Contact details and links come out with pattern matching and
need no AI at all; work history, education and projects need a backend if you
want them. Everything is shown section by section before any of it is saved.

**Fills the form.** Fields are matched by label, name, id and placeholder —
contact details, links, work history, education, work authorization and EEO,
logistics, custom questions. React-controlled inputs and radio groups included.
Anything it cannot place is listed so you can tell it once what that field is;
it remembers per site and uses your answer before guessing again.

**Drives the dropdowns ATSs actually use.** Modern forms replace `<select>`
with comboboxes, including type-aheads that fetch their options as you type.
See [the ladder](#the-dropdown-ladder) below.

**Answers what it can already infer.** Whether you are currently enrolled,
whether you live in the city the job is in, whether you can make the office
days, when you could start — from the profile, without asking you again.

**Survives multi-page flows.** Workday-style steps that swap the form without
reloading are noticed, so a stale "12 filled" never makes a fresh page look
done. Every tab keeps its own fill, attachments and drafts, and drafting
continues with the panel closed.

**Attaches the right file.** Point it at the folder where you keep tailored
documents; it matches on company name and on "resume"/"cv"/"cover letter",
and falls back to a generic *Additional Documents* input when a form has no
dedicated one. Nothing is attached until you click the file by name.

**Tailors a resume to the posting.** One request turns your profile and the job
description into bullets written for that job, scored, constrained for verb
variety and per-role limits, and exported as `.docx`. Figures the model
estimated rather than read are marked as estimates before anything is sent.

**Drafts the open-ended answers.** Only the genuinely open questions —
dropdowns and anything inference already settles are left out. Saved reusable
answers are checked before any model is called, and every draft is yours to
edit before it goes in. Ollama locally, or OpenRouter, Anthropic, OpenAI, Groq
or your own endpoint with your own key. Either can back the other up, so a rate
limit does not end the run.

**Remembers every application.** See [Dashboard](#dashboard).

---

## The dropdown ladder

Deterministic first, and a model only when everything cheaper has failed:

| | Stage | Cost |
|---|---|---|
| 1 | Exact match on the option text | free |
| 2 | Word-set match, order-insensitive | free |
| 3 | Synonym table — *"Available immediately"* = *"Immediately available"* | free |
| 4 | Ask the model to pick from the options the form itself offered | one request |

A dropdown that still cannot be filled says **which stage it failed at** rather
than failing quietly. Stage 4 never invents an option, and a model answer that
would contradict a yes/no you saved is rejected in code — not merely
discouraged in the prompt.

## Dashboard

A page inside the extension, one click from the panel header. No host, no
server, no account, nothing deployed.

Every application is kept in full: the job description (even from ATS flows
where it lives on a different page than the form), the match score and keyword
gap, the exact bullets that went out, and both documents as the `.docx` files
actually sent.

Three views over one list — a **table** to sort and scan, a **board** where
dragging a card sets its status, and a **gallery** ordered by match. Search
reaches the job description itself, so *"who wanted Kubernetes"* is answerable.

Each application carries what only you can know: status, priority, tags, a next
action with a date, and what the posting said about salary. Edited in place,
saved as you type, and validated again on arrival — the extension accepts
writes to those six fields and nothing else.

---

## Privacy

Everything is on your machine. No server, no account, no analytics, no
telemetry, no crash reporting.

| | |
|---|---|
| Profile, settings, API keys, learned field mappings | `chrome.storage.local` |
| Application history and both documents | IndexedDB |
| Documents folder access | a handle you grant, revocable in your browser |

Data leaves your computer in exactly two cases, both on a button you pressed,
and only to the provider you configured with your own key:

- **Drafting and tailoring** — the question or job description from the page,
  plus the relevant parts of your profile.
- **Resume import with AI parsing** — the text of the resume you chose.

Point it at [Ollama](https://ollama.com) and neither leaves the machine.
Configure nothing and both features stay inactive.

The extension holds no `tabs` permission, declares no `externally_connectable`,
and answers no external web page in any build.

Full policy: **[docs/privacy-policy.md](docs/privacy-policy.md)**.

---

## How well does it actually fill?

Honestly measured, not asserted. Real application forms are saved as fixtures
and matched on every CI run, and the numbers are allowed to go up only:

| ATS | Fields matched | Wrong |
|---|---|---|
| Ashby | 7 / 7 | 0 |
| Greenhouse | 11 / 11 | 0 |
| Personio | 6 / 6 | 0 |

`wrong` must be zero — writing the wrong value into a live application is worse
than leaving a field blank, so a regression fails the build.

**Not yet measured:** Workday, Lever, SmartRecruiters, iCIMS. Multi-page flows
are handled in code and covered by unit tests, but no Workday fixture exists
yet, so treat that as untested rather than working. Adding one is
[documented](extension/fixtures/forms/README.md) and welcome.

---

## Development

```bash
git clone https://github.com/jordanavery/ApplyFlow-autofiller.git
cd ApplyFlow-autofiller
npm install --prefix extension
npm install --prefix dashboard
npm run build --prefix extension
```

The build bundles the dashboard into the extension, so both projects need
installing. Output is `extension/.output/chrome-mv3` — the same directory the
npm package and the release zip carry.

```bash
npm test --prefix extension     # 891 tests
npm test --prefix dashboard     # 33 tests
npm run check:mirror --prefix dashboard
```

`check:mirror` fails when the types the two projects copy between each other
drift apart — neither can import the other, so the copies are checked instead.

| | |
|---|---|
| `extension/` | the extension: WXT + React + TypeScript, Manifest V3 |
| `dashboard/` | the dashboard, a separate Vite app bundled into the extension |
| `packaging/npm/` | the `applyflow` npm package |
| `docs/` | privacy policy, [releasing](docs/releasing.md), [dashboard](docs/dashboard-guide.md) |

### Firefox

`npm run build:firefox --prefix extension` produces a working extension, but
the documents folder needs the File System Access API, which Firefox does not
implement. The extension detects that and says so rather than showing a button
that does nothing. Firefox is not listed as supported until that has a
fallback.

---

## Licence

[MIT](LICENSE).
