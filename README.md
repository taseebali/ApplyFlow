# ApplyFlow

A browser extension that fills job application forms from your own locally-stored profile, attaches the right resume/cover letter, and logs applications to a Notion tracker — all without leaving the tab you're applying from.

Your profile is stored locally (`chrome.storage.local`). Data leaves your computer only when you trigger one of these explicitly:

- **Log to Notion** sends the job details to Notion's API using a token you provide.
- **Draft answers**, if you've configured the OpenRouter backend, sends the question, your work history, and your projects to OpenRouter using your own API key. If you configure the Ollama backend instead, drafting runs against a local Ollama install and nothing leaves your computer. Until you configure either backend, drafting is inactive.
- **Resume import** sends your resume's text to whichever AI backend you configured, for the work history and projects pass only. With no backend configured, or with Ollama, nothing leaves your computer — contact details and links are extracted locally either way.

## Features

- **Resume import** — start setup by importing a PDF, Word (.docx), or plain text resume instead of typing everything. Contact details and links are extracted with plain pattern matching and need no AI; if an AI backend is configured, work history, education, and projects are extracted too. Everything is shown for review, section by section, before any of it touches your profile.
- **Autofill** — detects form fields by label/name/id/placeholder (contact info, links, work history, education, work authorization/EEO, logistics, custom Q&A) and fills them from your profile, including React-controlled forms and radio-button groups.
- **Document attach** — grant access to the folder where you save tailored resumes/cover letters; it matches files by company name and keyword ("resume"/"cv"/"cover letter"), falling back to a generic "Additional Documents" field when a form has no dedicated one.
- **Notion logging** — captures the job description (even from ATS flows where the description lives on a different page than the application form) and logs the application as a row in your existing Notion tracker database. Setup uses plain-language numbered steps with a "Test connection" button that reports success or an actionable error.
- **AI answer drafting (optional)** — a "Draft answers" action finds open-ended questions on the page and drafts replies using your work history, projects, and the job description. Saved reusable answers are checked first, before any model is called. Every draft is shown for you to edit before it's inserted into the page. Needs either Ollama running locally (nothing leaves your computer) or an OpenRouter account with your own API key; it stays inactive until you set one up.
- Everything lives in the browser's side panel — no separate settings tab to lose track of.

## Getting started

The extension source lives in [`extension/`](extension).

```bash
cd extension
npm install
npm run build
```

Then load `extension/.output/chrome-mv3` as an unpacked extension:

1. Open `chrome://extensions` (or `brave://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** and select `extension/.output/chrome-mv3`

Click the toolbar icon to open the side panel. The first time it opens, with no profile saved yet, it walks you through a short guided setup (contact info, work history, education, projects, saved answers, job preferences, documents, Notion, AI drafting) — every step can be skipped. After that, the panel opens straight into a compact daily view of action cards ("Fill this page", "Attach documents", "Log to Notion", "Draft answers"); the gear icon in the header reopens the same setup sections as plain tabs whenever you need to change something.

Run the test suite with `npm test` (Vitest) from `extension/`.

## Tech stack

[WXT](https://wxt.dev) + React + TypeScript, Manifest V3, Chrome side panel API.
