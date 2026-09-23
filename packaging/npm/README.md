# ApplyFlow

Fill job application forms from a profile that stays on your machine: autofill,
document attach, AI drafts, and a dashboard of everything you have applied to.

```bash
npx applyflow
```

That unpacks the built extension into `./applyflow-extension` and prints how to
load it. Pass a path to put it somewhere else:

```bash
npx applyflow ~/browser-extensions/applyflow
```

## Loading it

1. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`)
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Choose the folder the command printed

Click the toolbar icon to open the side panel.

Keep the folder: deleting it uninstalls the extension. To update, run the
command again with `--force` and press **Reload** on the extensions page.

## Why npx, rather than an install

Chrome will not let a program add an extension to your browser unless it came
from the Web Store — and that refusal is doing its job, because an extension a
package script can install is an extension that any package script can install.
So this command hands you the folder and the four clicks; nothing touches your
browser on its own.

## What it does with your data

Your profile, your documents and your application history are held by your own
browser, on your own computer. There is no server, no account and no telemetry.

Data leaves your machine only when you press a button that says it will, and
only to an AI provider you configured yourself with your own API key — or to
nowhere at all, if you point it at [Ollama](https://ollama.com) running
locally. Full policy:
[docs/privacy-policy.md](https://github.com/jordanavery/ApplyFlow-autofiller/blob/master/docs/privacy-policy.md).

## Firefox

`npx applyflow` ships the Chromium build. Firefox works apart from the
documents folder, which needs the File System Access API that Firefox does not
implement — build it yourself with `npm run build:firefox` from the repository
if you want it anyway.

## Source

[github.com/jordanavery/ApplyFlow-autofiller](https://github.com/jordanavery/ApplyFlow-autofiller)

MIT licensed.
