#!/usr/bin/env node
/**
 * `npx applyflow` — puts the built extension somewhere you can load it.
 *
 * What this deliberately does not do is install anything. Chrome refuses
 * programmatic installs of extensions that did not come from the Web Store,
 * and that refusal is the point of it: an extension that can be added to your
 * browser by a package script is an extension anyone's package script can add
 * to your browser. So this unpacks the folder and tells you the four clicks.
 *
 * The payload is the same `chrome-mv3` directory the GitHub release zips, put
 * here by `npm run pack:npm` in the repository root.
 */
import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const payload = join(here, '..', 'extension');

const args = process.argv.slice(2);
const target = resolve(args.find((a) => !a.startsWith('-')) ?? 'applyflow-extension');

if (!existsSync(payload) || readdirSync(payload).length === 0) {
  console.error(
    'This copy of the package carries no build.\n' +
      'Install it from npm, or build from the repository with: npm run pack:npm'
  );
  process.exit(1);
}

if (existsSync(target) && readdirSync(target).length > 0 && !args.includes('--force')) {
  console.error(`${target} already exists and is not empty. Pass --force to overwrite it.`);
  process.exit(1);
}

cpSync(payload, target, { recursive: true });

const version = JSON.parse(readFileSync(join(payload, 'manifest.json'), 'utf8')).version;

// Chromium spells its own settings page differently per browser, and naming
// the one you are actually using saves a search.
console.log(`
ApplyFlow ${version} unpacked into:

  ${target}

To load it:

  1. Open chrome://extensions   (brave://extensions, edge://extensions)
  2. Turn on "Developer mode"
  3. Click "Load unpacked"
  4. Choose the folder above

Then click the toolbar icon to open the side panel. Your profile is stored by
your own browser and stays on this machine; nothing is sent anywhere until you
configure an AI backend and press a button that says it will be.

Keep the folder — deleting it uninstalls the extension. Updating means running
this again with --force and pressing Reload on the extensions page.
`);
