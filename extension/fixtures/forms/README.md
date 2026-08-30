# Form fixtures

Saved application forms from real ATSs, used to measure whether filling
actually works. Unit tests prove our functions behave as written; these prove a
real form fills.

Accuracy is a **number that must not go down**. When a change improves
matching, raise the baseline in the fixture's `.expected.json`. When it drops
one, the suite fails and names the field.

## Capturing a new fixture

Open the application form in a browser, then run this in the devtools console.
It keeps everything matching depends on and drops the rest.

```js
const f = document.querySelector('form').cloneNode(true);
f.querySelectorAll('script,style,svg,noscript,path,button').forEach((n) => n.remove());
const keep = new Set([
  'id', 'name', 'type', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby',
  'aria-haspopup', 'aria-required', 'required', 'placeholder', 'for', 'class',
  'maxlength', 'pattern', 'inputmode', 'autocomplete', 'hidden', 'aria-hidden', 'style',
]);
f.querySelectorAll('*').forEach((el) => {
  [...el.attributes].forEach((a) => { if (!keep.has(a.name)) el.removeAttribute(a.name); });
});
copy(f.outerHTML.replace(/\s{2,}/g, ' ').replace(/>\s+</g, '>\n<'));
```

Save as `<ats>-<company>.html`, then write `<ats>-<company>.expected.json`.

## Rules

- **No personal data.** Capture a blank form, before typing anything. If a
  value, email, or session identifier survives, remove it by hand. These files
  are committed and public.
- **Capture after the page has rendered.** Most ATSs build the form in
  JavaScript; view-source gives an empty shell.
- **Trim only prose.** Long legal boilerplate can be shortened, and a comment
  left saying so. Never simplify the structure around a form control — the
  awkward nesting is the thing being tested.

## The expectations file

```jsonc
{
  "source": "https://…",          // where it came from
  "captured": "2026-08-30",
  "ats": "greenhouse",
  "expect": { "<element id>": "<schema path>" },   // must match, and to this
  "mustNotMatch": ["<element id>"],                // filling these would be wrong
  "openQuestions": ["<element id>"],               // should reach AI drafting
  "notMotQuestions": ["<element id>"],             // must NOT reach drafting
  "baseline": { "matched": 0, "wrong": 0 }
}
```

`expect` is the goal, `baseline.matched` is where we actually are. The gap
between them is the honest backlog.
