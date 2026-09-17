/**
 * Fails when the dashboard's copy of the transfer types has drifted from the
 * extension's.
 *
 * `dashboard/src/bridge.ts` copies its types from
 * `extension/lib/dashboard-bridge.ts` because the two are separate npm
 * projects and neither can import the other. "Change one, change both" was a
 * comment; this is what makes it something a build can check.
 *
 * Deliberately shallow: it compares the member names of the shared shapes, not
 * their formatting or their comments, which is where real drift shows up — a
 * field added on one side and forgotten on the other — without failing on a
 * rewrapped sentence.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION = join(here, '..', '..', 'extension', 'lib', 'dashboard-bridge.ts');
const RECORD = join(here, '..', '..', 'extension', 'lib', 'application-record.ts');
const DASHBOARD = join(here, '..', 'src', 'bridge.ts');

/** The members of `interface <name> ... { ... }`, by name, sorted. */
function members(source, name) {
  const declaration = new RegExp(`export interface ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const found = source.match(declaration);
  if (!found) return null;

  return [...found[1].matchAll(/^\s{2}(\w+)\s*[?]?:/gm)].map((m) => m[1]).sort();
}

/** The members of a string-literal union constant, e.g. STATUSES. */
function literals(source, name) {
  const found = source.match(new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`));
  if (!found) return null;
  return [...found[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** The `type: '...'` tags of the DashboardRequest union. */
function requestTypes(source) {
  const found = source.match(/export type DashboardRequest =([\s\S]*?);/m);
  if (!found) return null;
  return [...found[1].matchAll(/type:\s*'([^']+)'/g)].map((m) => m[1]).sort();
}

const extension = readFileSync(EXTENSION, 'utf8');
const record = readFileSync(RECORD, 'utf8');
const dashboard = readFileSync(DASHBOARD, 'utf8');

const problems = [];

function compare(what, left, right) {
  if (left === null || right === null) {
    problems.push(`${what}: could not be found in ${left === null ? 'the extension' : 'the dashboard'}.`);
    return;
  }
  const missing = left.filter((entry) => !right.includes(entry));
  const extra = right.filter((entry) => !left.includes(entry));
  if (missing.length > 0) problems.push(`${what}: the dashboard is missing ${missing.join(', ')}.`);
  if (extra.length > 0) problems.push(`${what}: the dashboard has ${extra.join(', ')}, which the extension does not send.`);
}

// TransferableRecord extends EditableProperties on both sides, so the two
// together are the full shape that crosses the boundary.
compare('TransferableRecord', members(extension, 'TransferableRecord'), members(dashboard, 'TransferableRecord'));
compare('EditableProperties', members(record, 'EditableProperties'), members(dashboard, 'EditableProperties'));
compare('DocumentSummary', members(extension, 'DocumentSummary'), members(dashboard, 'DocumentSummary'));
compare('DocumentPayload', members(extension, 'DocumentPayload'), members(dashboard, 'DocumentPayload'));
compare('DashboardRequest', requestTypes(extension), requestTypes(dashboard));
compare('STATUSES', literals(record, 'STATUSES'), literals(dashboard, 'STATUSES'));
compare('PRIORITIES', literals(record, 'PRIORITIES'), literals(dashboard, 'PRIORITIES'));

if (problems.length > 0) {
  console.error('The dashboard and the extension disagree about what crosses between them:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nBoth copies have to change together: extension/lib/dashboard-bridge.ts and dashboard/src/bridge.ts.');
  process.exit(1);
}

console.log('Transfer types match the extension.');
