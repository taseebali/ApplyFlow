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

/*
 * Personal data that must not be committed.
 *
 * A resume fixture with the author's real name, mobile number and email was
 * committed and pushed to a public repository, and shipped to reviewers inside
 * the Firefox sources zip on every release. The fixtures README already said
 * "No personal data. These files are committed and public" — this is what
 * makes that something other than a sentence.
 *
 * Shapes rather than a blocklist of one person's details: a German mobile
 * number and a real mailbox at a consumer provider are what a captured form or
 * a pasted resume actually leaks.
 */
const PII_PATTERNS = [
  [/\+49\s?1[5-7][0-9](?:\s?[0-9]){7,9}/, 'a German mobile number'],
  [/[A-Za-z0-9._%+-]+@(?:gmail|googlemail|outlook|hotmail|yahoo|gmx|web)\.[a-z.]{2,}/i, 'a personal email address'],
];

/** Source files people actually author, rather than the build output. */
const SOURCE_DIRS = ['lib', 'components', 'entrypoints', 'fixtures', 'scripts'];

function checkNoPersonalData() {
  for (const dir of SOURCE_DIRS) {
    let entries;
    try {
      entries = files(dir);
    } catch {
      continue; // A directory that does not exist here is not a failure.
    }
    for (const path of entries) {
      if (!/\.(ts|tsx|js|mjs|json|txt|html|md)$/.test(path)) continue;
      const text = readFileSync(path, 'utf8');
      for (const [pattern, what] of PII_PATTERNS) {
        if (pattern.test(text)) {
          // The match itself is not printed: this runs in CI logs.
          console.error(`Looks like ${what} in ${path}. Fixtures and tests are public — use an invented one.`);
          failed = true;
        }
      }
    }
  }
}

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
checkNoPersonalData();

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
