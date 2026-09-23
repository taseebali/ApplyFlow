/**
 * Builds the dashboard and copies it into the extension as a page of its own.
 *
 * The dashboard used to exist only as a hosted page, which is why the panel
 * had no link to it: there was nothing to link to, and in a release build the
 * extension deliberately answers no external page at all. Bundled here it is
 * chrome-extension://<id>/dashboard/index.html — no host to register, no
 * origin to trust, and it works in a published build.
 *
 * The dev server at localhost:5174 still works and is still the faster loop to
 * develop against; this is the copy that ships.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dashboard = join(here, '..', '..', 'dashboard');
const dist = join(dashboard, 'dist');
const target = join(here, '..', 'public', 'dashboard');

if (!existsSync(join(dashboard, 'node_modules'))) {
  // Better than a cryptic failure inside Vite. The extension can be built
  // without ever having touched the dashboard project.
  console.error(`The dashboard's dependencies are not installed.\nRun: npm install --prefix ${dashboard}`);
  process.exit(1);
}

/*
 * Vite's own entry, run on this Node rather than through npm.
 *
 * `execFileSync('npm.cmd', ...)` fails outright on Windows — Node refuses to
 * spawn a .cmd without a shell (EINVAL), and turning the shell on to work
 * around that is how a path with a space in it becomes an injection. A .js
 * file handed to process.execPath needs neither.
 */
const vite = join(dashboard, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(vite)) {
  console.error(`Vite is not installed in the dashboard.
Run: npm install --prefix ${dashboard}`);
  process.exit(1);
}
execFileSync(process.execPath, [vite, 'build'], { cwd: dashboard, stdio: 'inherit' });

// Replaced rather than merged, so a file deleted from the dashboard does not
// live on inside the extension.
rmSync(target, { recursive: true, force: true });
cpSync(dist, target, { recursive: true });

console.log(`Dashboard bundled into ${target}`);
