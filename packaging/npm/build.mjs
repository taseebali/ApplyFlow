/**
 * Assembles the npm package: build the extension, copy it in, match versions.
 *
 * The package carries the built `chrome-mv3` output rather than any source, so
 * `npx applyflow` needs no toolchain and no build on the user's machine — it
 * unpacks a directory and stops.
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const extension = join(repo, 'extension');
const built = join(extension, '.output', 'chrome-mv3');
const payload = join(here, 'extension');

// Always a fresh build: shipping whatever happened to be in .output is how a
// package goes out carrying last week's code.
execFileSync(process.execPath, [join(extension, 'node_modules', 'wxt', 'bin', 'wxt.mjs'), 'build'], {
  cwd: extension,
  stdio: 'inherit',
});
execFileSync(process.execPath, [join(extension, 'scripts', 'check-no-secrets.mjs')], {
  cwd: extension,
  stdio: 'inherit',
});

if (!existsSync(built)) {
  console.error(`No build at ${built}`);
  process.exit(1);
}

rmSync(payload, { recursive: true, force: true });
cpSync(built, payload, { recursive: true });

// One version across the manifest, the extension's package.json and this one,
// so `npx applyflow` and the GitHub release of the same tag are the same code.
const manifest = JSON.parse(readFileSync(join(payload, 'manifest.json'), 'utf8'));
const pkgPath = join(here, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

if (pkg.version !== manifest.version) {
  pkg.version = manifest.version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Package version set to ${manifest.version}`);
}

console.log(`Packed ${manifest.name} ${manifest.version} into ${payload}`);
