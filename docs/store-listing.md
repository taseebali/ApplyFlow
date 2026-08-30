# Chrome Web Store submission

Everything a reviewer asks for, written down so it is not improvised at
submission time. Nothing here is submitted automatically — publishing is a
deliberate act, and the account owner does it.

## Permission justifications

A reviewer rejects vague answers. Each of these says what the permission does
and why the extension cannot work without it.

| Permission | Justification |
|---|---|
| `storage` | Stores the user's own profile, settings, learned field mappings, and application history on their machine. Nothing is sent to a server we operate — there is no server. |
| `sidePanel` | The entire interface is the side panel. It sits beside the job application so the user never leaves the page they are filling. |
| `<all_urls>` content script | Job applications are hosted on thousands of domains — every company's careers page, plus Greenhouse, Lever, Workday, Personio, SmartRecruiters and others, frequently embedded in an iframe on the employer's own site. There is no enumerable list. The script only reads form structure and only writes when the user presses a button. |
| `https://api.notion.com/*` | Optional. Logs an application to the user's own Notion database using a token they supply. Skippable, and the feature hides itself when skipped. |
| `https://openrouter.ai/*`, `https://api.anthropic.com/*`, `https://api.openai.com/*`, `https://api.groq.com/*` | Optional AI answer drafting, using the user's own API key with the provider they choose. Only called when the user presses "Draft answers". |
| `http://localhost:11434/*` | Optional local drafting via Ollama, so a user can keep everything on their own machine. |
| `optional_host_permissions: https://*/*` | Only for a self-hosted or less common OpenAI-compatible endpoint. Nothing is granted until the user enters their own URL and presses the button; Chrome then prompts for that single host. HTTPS only — the request carries an API key. |

## Single purpose

> Fill job application forms from a profile stored on the user's own computer,
> attach their resume and cover letter, and optionally draft answers to
> open-ended questions for the user to review before anything is entered.

## Data handling disclosures

- **Personally identifiable information** — collected and stored *locally only*.
- **Not sold, not transferred** to third parties for any purpose.
- **Not used** for creditworthiness or lending.
- **Sent off the device only when the user acts**, and only to:
  - the user's own Notion workspace, when they press "Log to Notion";
  - the AI provider the user configured with their own key, when they press
    "Draft answers" or import a resume with AI parsing enabled.
- Nothing is sent to any endpoint operated by this project.

## The privacy policy must state plainly

1. The profile, documents folder handle, learned mappings, application history
   and API keys never leave the user's machine except as above.
2. Which data is included in an AI request: the question, the job description
   scraped from the page, and the relevant parts of the profile (work history,
   projects, education, languages, location).
3. That free AI models are served by providers who may train on what is sent,
   that the extension says so at the point of choosing one, and that a paid
   model or Ollama avoids it.
4. That no analytics, telemetry, or crash reporting of any kind is collected.
5. A contact address for questions and deletion requests.

## Before submitting

- [ ] Publish the privacy policy at a stable URL and put it in the listing.
- [ ] Screenshots: the side panel next to a real application, the setup wizard,
      the drafting card. No personal data visible in any of them.
- [ ] Confirm `npm run build` passes, including the bundled-secret check.
- [ ] Load the built `chrome-mv3` folder unpacked and walk the whole flow once.
- [ ] Check the version in `wxt.config.ts` matches `package.json` and the tag.

## Firefox

`build:firefox` produces a working extension, but the documents folder needs
the File System Access API, which Firefox does not implement. The extension
detects this and says so in Setup rather than showing a button that does
nothing. Do not list Firefox as fully supported until that feature has a
fallback.
