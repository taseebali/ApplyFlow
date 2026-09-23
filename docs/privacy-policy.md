# ApplyFlow privacy policy

_Last updated: 24 September 2026_

ApplyFlow is a browser extension that fills job application forms from a
profile you enter yourself. This policy describes what it does with your data.
It is short because the extension does very little with it.

## The short version

There is no ApplyFlow server. There is no account, no sign-up, no analytics and
no telemetry. Your profile, your documents and your application history are
stored by your own browser on your own computer, and nothing is transmitted
anywhere unless you press a button that says it will be.

## What is stored, and where

All of it is on your machine, in your browser's own storage:

| Data | Where it lives |
|---|---|
| Profile: name, contact details, links, work history, education, projects, languages, saved answers, job preferences | `chrome.storage.local` |
| Settings, including any AI provider API keys you enter | `chrome.storage.local` |
| Field mappings you teach it for a particular site | `chrome.storage.local` |
| Application history: the posting, the match score, and the résumé and cover letter as sent | IndexedDB |
| A handle to the documents folder you granted access to | IndexedDB |

Uninstalling the extension removes all of it. "Clear history" in the panel
removes the application records, and the panel's own controls let you delete or
export anything else.

## What leaves your computer, and when

Only two things, both only when you act, and both only to a provider you chose
and configured yourself:

**1. AI answer drafting and résumé tailoring** — when you press "Draft
answers", "Tailor this application", or generate a bullet bank. Sent: the
question or the job description read from the page, and the relevant parts of
your profile (work history, projects, education, languages, location). Not
sent: your API keys other than as the request's own authorisation, your
documents, your application history, or any field you did not ask about.

**2. Résumé import with AI parsing** — when you import a résumé and an AI
backend is configured. Sent: the text of the résumé you chose. Contact details
and links are extracted on your machine and need no AI at all.

Where they go is your choice, made in Settings:

- **Ollama**, running on your own machine — nothing leaves your computer.
- **OpenRouter, Anthropic, OpenAI or Groq**, using an API key you supply. The
  request goes to that provider, under their privacy policy and your account
  with them.
- **A custom OpenAI-compatible endpoint** you name. HTTPS only, because the
  request carries your key; a plain `http://` address is refused unless it is
  on your own machine.

If you configure no backend, these features are inactive and nothing is ever
sent.

**Free models train on what you send.** Providers who serve models at no cost
generally reserve the right to use the content for training. The extension says
so at the point where you pick one. A paid model, or Ollama, avoids it.

## What is never collected

- No analytics, telemetry, usage statistics, crash reports or error reporting.
- No advertising identifiers, and no data sold or shared with anyone.
- No browsing history. The extension does not hold the `tabs` permission; it
  sees only the address of a page on which you open the panel.
- Nothing is sent to any endpoint operated by this project, because there is
  no such endpoint.

## Permissions, and why each exists

| Permission | Why |
|---|---|
| `storage` | Keeps your profile and settings on your machine. |
| `sidePanel` | The interface is the side panel. |
| Content script on all sites | Job applications live on thousands of domains, often inside an iframe on a company's own careers page, so there is no list to enumerate. It reads a page's form structure and writes only when you press a button. |
| `openrouter.ai`, `api.anthropic.com`, `api.openai.com`, `api.groq.com`, `localhost:11434` | The AI backends you can choose between. Contacted only when you use an AI feature. |
| Optional access to a host you name | Only for a self-hosted endpoint. Nothing is granted until you enter the URL and confirm, and your browser then asks about that single host. |

The dashboard is a page inside the extension. It reads your records through the
browser's own internal messaging, not over a network, and the extension answers
no external web page at all.

## Your documents

If you grant access to a folder, the extension reads résumés and cover letters
from it to attach to applications, and writes documents it generates back to
it. That access is granted by you through your browser's own file picker, it
covers only the folder you chose, and it can be revoked in your browser's site
settings at any time. Files are attached to a form only after you click the
specific file, by name.

## Children

ApplyFlow is not directed at children under 16 and does not knowingly hold
their data.

## Changes

Material changes to this policy will be noted in the release that carries them,
with the date above updated.

## Contact

Questions, or a request about your data, through the issue tracker of the
project's repository. Since nothing is held on any server, there is no data for
this project to delete on your behalf — removing the extension removes it all.
