/**
 * Fails the build if anything key-shaped reached the bundle. The dev-only
 * prefill in lib/dev-prefill.ts is guarded by `import.meta.env.DEV`, so a
 * release build should contain no trace of it — this is what makes that
 * guarantee something other than a comment.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '.output';

// OpenRouter keys start `sk-or-`; Notion integration tokens `secret_`/`ntn_`.
const PATTERNS = [/sk-or-v?\d?-[A-Za-z0-9]{16,}/, /\bsecret_[A-Za-z0-9]{32,}/, /\bntn_[A-Za-z0-9]{32,}/];

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

let failed = false;
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
  console.error('\nA credential appears to have been bundled. Do not ship this build.');
  process.exit(1);
}
console.log('No credentials found in the build output.');
