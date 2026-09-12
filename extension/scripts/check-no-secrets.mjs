/**
 * Fails the build if anything key-shaped reached the bundle. The dev-only
 * prefill in lib/dev-prefill.ts is guarded by `import.meta.env.DEV`, so a
 * release build should contain no trace of it — this is what makes that
 * guarantee something other than a comment.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '.output';

// OpenRouter keys start `sk-or-`; Notion integration tokens `secret_`/`ntn_`.
const PATTERNS = [
  /sk-or-v?\d?-[A-Za-z0-9]{16,}/,
  /\bsecret_[A-Za-z0-9]{32,}/,
  /\bntn_[A-Za-z0-9]{32,}/,
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
];

let failed = false;

/**
 * The extension's signing key is gitignored. This is what catches it on the
 * day that stops being true — whoever holds that key can publish an update to
 * every installed copy, and a committed key has to be rotated whether or not
 * the commit was ever pushed.
 */
function checkNoCommittedKeys() {
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '--full-name', '../'], { encoding: 'utf8' });
  } catch {
    // No git, or not a checkout: a source tarball has nothing to check.
    return;
  }
  for (const line of tracked.split('\n')) {
    const path = line.trim();
    if (!/\.pem$/i.test(path)) continue;
    console.error(`Private key committed to the repository: ${path}`);
    failed = true;
  }
}

checkNoCommittedKeys();

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

for (const path of files(ROOT)) {
  if (!/\.(js|html|json|css)$/.test(path)) continue;
  const text = readFileSync(path, 'utf8');
  for (const pattern of PATTERNS) {
    const hit = text.match(pattern);
    if (hit) {
      // Deliberately does not print the match.
      console.error(`Secret-shaped string (${pattern}) found in ${path}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nA credential appears to have been bundled or committed. Do not ship this build.');
  process.exit(1);
}
console.log('No credentials in the build output, and no private key committed.');
