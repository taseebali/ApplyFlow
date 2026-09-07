# Shakedown fixes, 7 September 2026

Fourteen items from a real run, plus three UI decisions taken after reviewing
the first tailored output. Ordered by what blocks use, not by list order.
Several are mine, and the worst two are.

---

## Tier 1: broken now, cheap to fix

### 4. The skills field cannot take a second skill

**Why.** It trims and re-splits on every keystroke, so a space or a comma is
deleted the instant you type it. "Python kf" becomes "Pythonkf". My last edit
here half-applied: the hint text changed to describe line-based groups, the
input handler did not, so the instructions now describe a control that does not
exist. That is also why the instructions read as vague.

**Fix.** Chips, per the Emblor reference (a tag input built on shadcn/ui): type,
press Enter, the term becomes a rounded chip with an x on it. Keep an
uncommitted draft in local state so no keystroke is ever rewritten, and only
touch the profile when a chip is committed. Backspace on an empty field removes
the last chip. Groups become a label on a row of chips rather than a syntax the
user has to remember.

### 1. "Skip" stays "Skip" after you have filled the step in

**Why.** The label is chosen from whether the step is optional, never from
whether anything was entered.

**Fix.** Ask the step whether it now has content. Optional and untouched reads
"Skip"; optional and filled reads "Next".

### 7. It spent money without asking

**Confirmed from the generation record**, not guessed. One request:

```
model            google/lyria-3-clip-preview-20260330
provider_responses  lyria-3-pro-preview   -> 504
                    lyria-3-clip-preview  -> 200
router_latency   5396 ms
tokens           393 prompt / 102 completion
usage            $0.04
```

Three defects, and every one of them is visible in those eight lines.

1. **Nothing filters the candidate pool by modality.** Lyria is Google's
   music-generation line. A music model was a candidate for drafting a cover
   letter, which means the pool is not "free text models" - it is whatever the
   catalogue endpoint returned, minus a price check.
2. **`isFree` trusts the catalogue's price.** Preview models routinely list
   zero or no price and bill anyway, which is exactly what happened: it passed
   the filter and charged $0.04. The only signal worth trusting is the `:free`
   suffix on the model id.
3. **We hand OpenRouter a `models` array, so the fallback is theirs.** Two
   provider responses in one request and 5.4 seconds of router latency are that
   feature working as documented: the first choice timed out at 504 and their
   router silently moved to the next. Even if we had vetted candidate one, we
   never approved what it falls through to.

$0.04 a request puts the $0.20 at roughly five requests, which matches.

**Fix.**

- Restrict the pool to text-in, text-out models, and exclude anything marked
  preview.
- Under a free policy, require the id to end in `:free` and ignore the numeric
  price fields entirely.
- Send exactly one model per request and do our own fallback, so a 504 can
  never route to something we did not choose.
- Show what the session has spent, in the panel, where it cannot be missed.

The key label in the record is truncated by OpenRouter and the hash beside it
is a SHA-256, so neither is usable - nothing needs revoking on account of that
paste. The record itself stays out of the repo.

### 13. "Fill this application" is now redundant

**Why.** It is a leftover. The row and the sticky "Review N changes" button do
the same thing, and the mirror above already shows what would be written.

**Fix.** Remove the row. Keep Attach, Tailor, Draft and Log, which do different
things.

### 14. Back from settings goes to settings

**Why.** The back arrow has one destination. Opening settings from the command
palette and pressing back returns you to the settings list rather than to where
you came from.

**Fix.** Remember where the navigation started and return there.

### 5. Logistics is a wall of captions

**Why.** Every field carries its own explanation whether or not it needs one.

**Fix.** Keep the one caption that earns its place (the "how did you hear about
us" ordering, which is genuinely not obvious) and drop the rest. Shorten the
labels.

---

## Tier 2: wrong output

### 2. Hyperlinks come through as their anchor text

**Why.** Two different failures.

`.docx` uses mammoth's `extractRawText`, which drops hyperlinks entirely. A
"Live Demo" link arrives as the words "Live Demo" and that is what lands in the
Link field - exactly what the screenshot shows.

`.pdf` does read the annotation layer, but appends every URL as a flat list at
the end of the document, disconnected from the project it belonged to. So a
project either gets no link or gets whichever link matched first, which is why
the RAG System shows the profile GitHub rather than its own repository.

**Fix.** For `.docx`, use `convertToHtml` and read `<a href>` in place, so the
link stays attached to the line it was on. For `.pdf`, each annotation carries a
rectangle: match it to the nearest text line by vertical position instead of
dumping it at the end. Normalise on the way in - add `https://` when missing,
strip tracking parameters.

### 11. A three-word answer written as three paragraphs

**Why.** When a form declares no maximum length, the prompt says "aim for
120-180 words" - for every question. "How long should your internship last?"
gets the same instruction as "Why do you want to work here?".

**Fix.** Read the length out of the question. "How long", "when", "what is your
notice period", "earliest start date", anything answerable with a date or a
duration, gets a one-sentence budget. "Why", "tell us about", "describe" keeps
the paragraph budget. A declared `maxlength` still wins over both.

### 9. Location is not detected, and the page already knows the answer

**Why.** It is a combobox with no native `<select>`, so there is nothing to read
a value from, and matching never gets a list of what is allowed.

**Fix.** You are right that this is the obvious move. The plan already reads the
page's own controls; it should also read their **options** - a combobox's
listbox items, a select's `<option>`s, a radio group's labels - and show them in
the panel. Then matching becomes picking from a list the page itself supplied
rather than guessing a string, and a field we cannot match shows its options so
you can pick one without leaving the panel.

### 12. Notion cannot auto-detect the posting

**Why.** Same root as the empty job context: the job description is scraped from
whichever frame answers, and on an embedded application that is the wrong frame.
The frame fix from last session should have helped; the screenshot showing
"couldn't auto-detect" was taken before it, so this needs re-testing before more
work goes into it.

**Fix.** Re-test first. If it still fails, the scraper needs the posting's own
structured data (JSON-LD `description`) rather than a text sweep.

---

## Tier 3: the resume itself

### 10. What is wrong with the tailored resume

Reading it against the reference, without being told:

1. **Knight's Tour is on it.** A weekend backtracking exercise appears on a
   resume for an AI internship, and in the second run it sat fourth while seven
   better projects were cut. That is the worst thing on the page.

2. **Its three bullets all say the same thing.** "Designed a backtracking
   algorithm", "Built a backtracking implementation", "Solved the Knight's Tour
   problem end-to-end". Three angles on one sentence of source.

3. **No summary, no skills, no languages.** The page is projects, education,
   and nothing else.

4. **No numbers anywhere.** The reference says "10 real verified bug fixes, 90%
   file-match rate, 7.4 tool calls per case". This says "against real, verified
   bug fixes".

5. **The RAG System's link is the profile GitHub**, not the project's. See #2.

6. **Bullet counts are inconsistent** - four for the bank path, three for the
   fallback - because two different limits apply depending on which path ran.

7. **The keywords it is ranking against are noise.** The match chips read
   `why`, `ll`, `days`, `find`, `manual`, `built`, `flow`. Those are not things
   a posting asks for; they are common words that survived the extractor. Both
   the 76 score and any relevance ranking built on those terms are measuring
   nothing. This has to be fixed before ranking, or ranking sorts by noise.

**Root cause of 1 and 2.** Ranking is `(tailored ? 1000 : 0) + term overlap`.
The 1000 means any project the bank happened to succeed for outranks any project
it failed for, whatever either one is worth. And generation writes six framings
per source no matter how thin the source is, then selection takes three.

**Fix.**

- **Fix `contentTerms` first.** Drop the generic-verb and filler band (`why`,
  `built`, `find`, `manual`, `days`, `flow`, `ll`); keep technical nouns and
  named tools. The gap chips and the score get honest at the same time.
- **Rank on relevance to the posting.** Tailored-or-not becomes a tie-break
  worth one point, not a thousand.
- **Add a substance signal** so a one-sentence exercise cannot outrank a real
  system: how many distinct source bullets the item has, whether any carries a
  number, whether it names tools the posting names.
- **Cap bullets by source volume.** One sentence of source contributes one line.
  Same cap on both paths, so counts stop depending on which one ran.

### 10b. Always one page

`MAX_PROJECTS = 4` is a guess at what fits, applied whether the projects are one
line or six and whether or not there is a summary, a skills block and a
languages line above them. A guess cannot hold a page.

**Fix.** Measure. The review tab already renders the document; render it at the
real page width with a page-boundary rule, and trim the lowest-ranked project
until the content clears the rule. The constant becomes a starting point, not
the rule. Section order is fixed and the trim only ever takes projects from the
bottom - it never drops experience, education or skills to make room.

### 3. Summary, skills, headline (and languages) should fill themselves

**Why.** Nothing populates them. Import never reads them and there is no
generation step, so `summary` and `headline` are empty strings and `skills`
holds the broken value from #4. Empty means the section is skipped, which is why
the page had neither. `languages` is on the profile but the resume document has
no field for it at all.

**Fix.** Add a languages line to the document and render it beside skills. Fill
summary / skills / headline from three sources in order: the resume if it has
them (a SUMMARY section, a SKILLS section), generated from the rest of the
profile if it does not, and never overwriting anything typed by hand. Generated
text is marked as generated so it is obvious what to check.

### 6. The bank should assume numbers rather than refuse them

**Why.** It is built on the opposite rule - facts come from you, phrasing comes
from the model, and a missing number is asked for rather than invented. Which
is why seven items report "nothing measurable".

**What you are asking for.** Let the model estimate plausible figures from what
the project plainly implies, and where there is genuinely nothing to estimate,
write the impact without a number rather than leaving it flat.

**Worth saying once.** An invented number on a resume is a number you have to
defend in an interview. I will build it because you have asked twice and it is
your resume, but I will make every estimated figure visibly marked in the panel
so you can confirm or correct it before it goes out, and the estimate will be
constrained to what the source supports rather than free invention.

### 8. The documents folder is never asked for during onboarding

**Why.** I removed it deliberately, on the reasoning that it is not needed to
fill a form and the readiness line would raise it later. That was wrong: it is
needed for attaching and for saving a tailored resume, which is most of the
point, and "2 things before you can fill this" on first use is a bad greeting.

**Fix.** Put it back as an optional step after the bank.

---

## Tier 4: the three UI decisions

### A. The review tab becomes a document editor

Today it is a form that describes a document: a list of textareas, a "your
wording" pill, a fault pill, a "keep this wording" link. You never see the
resume. The thing you are about to send is only visible after it is saved and
opened in Word.

**References.** [OpenResume](https://github.com/xitanggg/open-resume) and
[Reactive Resume](https://rxresu.me/) both split the screen: inputs on the left,
the actual page rendered on the right, updating as you type, with the page
boundary drawn. Both run entirely in the browser with no server, which is also
our constraint.

**What we build, and what we skip.** The right pane renders `ResumeDocument` -
the same object `toDocxBlob` consumes - as HTML at page width with a one-page
rule across it. Preview and file cannot drift, because they are the same object.

Editing happens **on the document**, not in a mirrored form. Each bullet is a
`contenteditable="plaintext-only"` line in the rendered page. That is a native
Chrome feature and this is a Chrome extension, so it costs one attribute and no
dependency. No ProseMirror, no TipTap, no Slate, no split-pane library, no CSS
framework - a two-column grid is two lines of CSS.

The left rail then holds only what typing cannot do: swap a bullet for another
variant from the bank, drop or restore a section, reorder projects, keep a
wording, the match chips, the page-fit indicator, and Save. If the left rail
duplicates the document as a form, it is dead weight - the document *is* the
form.

*skipped: rich-text editing, templates, fonts, drag-and-drop reordering. Add
drag-to-reorder when up/down buttons prove annoying, not before.*

### B. Tailor becomes a menu, not a button

Today, clicking the row runs the whole tailoring pass. If you only wanted a
cover letter you have paid for a resume you will not use, and the row's label
promises only one of the two things it does.

**References.** [Teal](https://www.tealhq.com/tool/cover-letter-generator) keeps
the resume builder and the cover letter generator as separate tools with
separate costs; [OphyAI](https://ophyai.com/us/application-assistant) has you
pick the document type before it spends anything. The pattern is the same in
both: choose the artefact first, pay for that one.

**What we build.** The row title becomes "Tailor this application" and clicking
the row expands rather than runs. Inside: three buttons - **Resume**, **Cover
letter**, **Both** - each showing what it will cost in requests before you press
it. Nothing runs until one is pressed.

The cover letter path needs the resume bullets today, so "Cover letter" alone
selects from the bank without generating new variants - selection is local and
free; only generation costs anything.

### C. An accent colour, used as the secondary

The accent is not a highlight on one screen. It is the extension's second
colour, carrying every control that has more than one state: expanded and
collapsed rows, selected tabs, toggles, focus rings, the score ring, the
primary action, the AI-drafted marker. That changes what it has to be. A colour
shown once per screen can be loud; a colour shown forty times cannot.

**What the constraint actually leaves.** Three semantic colours are spoken for -
`--ok` green (145 deg), `--wait` amber (40 deg), `--bad` red (5 deg) - and the
accent takes over `--ai`, so blue is freed rather than kept. Teal and cyan sit
next to the success green and are what Simplify, Jobright and SpeedyApply all
use. Indigo-violet around 265 is the default AI purple. Anything warm from
340 through 20 is the error red. **That leaves roughly 295-320, and nothing
else.**

**Chosen: plum-magenta, hue 312.** `#9e3389` on the light ground, `#e07ecd` on
the dark one, with `#f2e8f0` / `#2a1d2a` as the tint fills.

Measured rather than asserted:

| | light | dark |
|---|---|---|
| accent on the ground | 6.1:1 | 7.4:1 |
| foreground on the accent fill | 6.4:1 | 8.0:1 |
| accent text on its own tint | 5.3:1 | 6.1:1 |
| deltaE from the error red | 65.6 | 50.3 |
| deltaE from amber / green | 85 / 104 | 98 / 124 |

Everything clears AA for text, not just for large text, which matters because
this colour lands on 11px pills and 12px chevrons. Every deltaE is above 50,
where two UI colours are confusable below about 25 - so the accent can never be
misread as an error at small size, which is the failure that actually matters.
Saturation is 68 percent, deliberately below the 80 the design guidance caps
at, because this is a high-frequency colour.

**Rejected, and why.** Cerise `#c0006b` and raspberry `#be185d` - my earlier
recommendation - measure 36 and 28 degrees from the error red and run at 87-100
percent saturation. Both fail the small-size test. Acid chartreuse reads as a
cousin of the success green. Iris `#4f46e5` is the default AI violet and is the
blue being removed.

**Where it lands.** `--accent` and `--accent-text` already exist as tokens and
are currently aliased to `--primary`, so pointing them at a real hue repalettes
every screen in one file. `--ai` and `--ai-bg` fold into the accent; the state
set becomes accent, ok, wait, bad.

---

## What shipped

Every item below is implemented and on `ui-redesign-ai-drafting`. 740 tests
pass, typecheck and build are clean, and the fixture corpus is unmoved at
greenhouse 11/11, personio 6/6, ashby 6/6.

| | Item | Commit |
|---|---|---|
| 4 | Skills as chips | `f0d08b7`, `17c5d83` |
| 1, 5, 13, 14 | Wizard label, logistics, the redundant row, back navigation | `173b1a9` |
| 7 | The spend guard | `0a35547` |
| 2, 11 | Hyperlinks, answer length | `774d5d3` |
| 10, 10b, 3 | Ranking, bullet caps, summary/skills/languages | `b073d6b` |
| A | The review tab as a document editor | `78e79b0` |
| B | Tailoring as a menu | `7c630d9` |
| 9 | The page's own options | `4e33253` |
| 6 | Estimated figures, marked | `a60ae68` |
| 8, 12 | Folder step, Notion-rendered postings | `3052eb6` |
| C | The accent | `0d03fc9` |

Two things still need you rather than me. **#12** needs a live Notion posting to
confirm — the scraper reaches one now, but only a real page says whether that
was the whole problem. And the manual pass below is the only thing that says
any of this actually got better.

## Order of work

1. #4 skills chips, #1 button label, #5 logistics, #13 remove the row, #14 back
   navigation, plus **C** the accent - all small, all visible.
2. #7 the spend guard, once the OpenRouter log says what was charged.
3. #2 hyperlinks, #11 answer length.
4. #10 in order: keyword noise, then ranking, then bullet caps; then #3 summary,
   skills and languages; then 10b one-page-by-measurement.
5. **A** the review editor, which is where 10b is verified.
6. **B** the tailor menu.
7. #9 read the page's own options into the mirror - the largest, and the one
   that makes matching stop guessing.
8. #6 estimated numbers, with every estimate marked.
9. #8 folder step, #12 re-test Notion detection.

## Verification

Every tier ends with the same check: import the real resume, generate a tailored
one, and read it beside `Jordan_Avery_Application_Enpal.pdf`. It must be one page,
carry a summary, a skills block and languages, and contain no weekend exercise.
The tests hold the line; that comparison is the only thing that says whether it
got better.
