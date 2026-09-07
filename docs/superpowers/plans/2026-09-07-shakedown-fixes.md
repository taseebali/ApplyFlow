# Shakedown fixes, 7 September 2026

Fourteen items from a real run. Ordered by what blocks use, not by list order.
Several are mine, and two of those are the serious ones.

---

## Tier 1: broken now, cheap to fix

### 4. The skills field cannot take a second skill

**Why.** It trims and re-splits on every keystroke, so a space or a comma is
deleted the instant you type it. "Python kf" becomes "Pythonkf". My last edit
here half-applied: the hint text changed to describe line-based groups, the
input handler did not, so the instructions now describe a control that does not
exist. That is also why the instructions read as vague.

**Fix.** Chips, per the Emblor reference (a tag input built on shadcn/ui): type,
press Enter, the term becomes a rounded chip with an × on it. Keep an
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

**Why.** Three holes, and I do not know yet which one charged the $0.20:
`isFree` accepts a model whose *prompt* is free even when its completion is
paid; more than one candidate is sent to OpenRouter as a `models` array, and
that is OpenRouter's own routing feature choosing between them; and nothing
anywhere checks a model's price at the moment of calling it. Worse than any of
those: nothing ever told you money could be spent.

**Fix.** A hard client-side guard - with a free policy, refuse to send a model
the catalogue does not price at zero for both prompt and completion, and say so
rather than silently substituting. Stop sending the `models` array when the
policy is free, so routing stays ours. Show spend for the session in the panel.

**Check first.** OpenRouter → Logs lists model and cost per request. That names
the culprit in a minute; I would rather fix the one that happened than all three
on a guess.

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

## Tier 3: needs a decision

### 10. What is wrong with the tailored resume

Reading it against the reference, without being told:

1. **Knight's Tour is on it.** A weekend backtracking exercise appears on a
   resume for an AI agents internship, while the Real-Time Vision system - the
   one project with hard numbers, 8-9 FPS at 0.7GB - is left off. That is the
   worst thing on the page.

   **Why.** Ranking puts anything the bank covered above anything it did not,
   by a margin nothing can overcome. The bank happened to succeed for Knight's
   Tour and fail for Real-Time Vision, so a weekend exercise outranked the best
   project on merit it does not have.

2. **Knight's Tour's three bullets all say the same thing.** "Shipped a working
   backtracking solver", "Designed a backtracking algorithm", "Solved the
   Knight's Tour problem end-to-end". Three angles on one sentence of source.

   **Why.** Generation writes six framings per item and selection takes up to
   three, regardless of how much the item actually had to say.

3. **No summary, no skills section.** The page is projects and nothing else.

4. **No numbers anywhere.** The reference says "10 real verified bug fixes, 90%
   file-match rate, 7.4 tool calls per case". This says "against real, verified
   bug fixes". The numbers were never in the imported profile, so nothing could
   put them back.

5. **The RAG System's link is the profile GitHub**, not the project's. See #2.

6. **Bullet counts are inconsistent** - four for the bank path, three for the
   fallback - because two different limits apply depending on which path ran.

**Fix.** Rank on relevance to the posting first and use bank coverage only to
break ties. Cap bullets by how much the source actually contains, not by a flat
three. Make an item with one sentence of source contribute one line.

### 3. Summary, skills and headline should fill themselves

**Why.** They are empty because nothing populates them. Import never read them,
and there is no generation step.

**Fix.** Three sources in order: take them from the resume if it has them (a
SUMMARY section, a SKILLS section); generate them from the rest of the profile
if it does not; and never overwrite anything typed by hand. Generated text is
marked as generated so it is obvious what to check.

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

## Order of work

1. #4 skills chips, #1 button label, #5 logistics, #13 remove the row, #14 back
   navigation. All small, all visible.
2. #7 the spend guard, once the OpenRouter log says what was charged.
3. #2 hyperlinks, #11 answer length. Both change output quality directly.
4. #10 ranking and bullet caps, #3 summary generation.
5. #9 read the page's own options into the mirror. The largest, and the one that
   makes matching stop guessing.
6. #6 estimated numbers, with every estimate marked.
7. #8 folder step, #12 re-test Notion detection.

## Verification

Every tier ends with the same check: import the real resume, generate a tailored
one, and read it beside `Jordan_Avery_Application_Enpal.pdf`. The tests hold the
line; that comparison is the only thing that says whether it got better.
