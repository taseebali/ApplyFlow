# Application Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Notion tracking with a dashboard that records every application in full — job description, the exact bullets sent, both finished documents — and answers which wording actually gets replies.

**Architecture:** The record moves from `chrome.storage.local` to IndexedDB, because the current log is capped at 500 entries and shares a ~10MB quota with the profile, snapshots, the bullet bank and the model catalogue — and embedded `.docx` bytes would exhaust it. The dashboard is a static React app deployed to Vercel that holds no data of its own: it asks the extension for records over `externally_connectable` messaging and renders them. Nothing is stored on a server, there is no database, and no account is needed. Notion is deleted last, after the dashboard has proven it records everything Notion did.

**Tech Stack:** IndexedDB (no wrapper library), WXT 0.21, React 19, TypeScript 5.9, Vitest + jsdom, `fake-indexeddb` for tests, Vite for the dashboard app, Vercel for static hosting.

**Spec:** None. This plan is the design record; it was settled in conversation on 2026-09-11, where architecture "B" (Vercel hosts the page, the extension holds the data) and "everything, files embedded" were chosen over a hosted database and over metadata-only records.

## Global Constraints

- Profile and application data stay on the machine. The only outbound traffic remains AI drafting to the configured provider. The dashboard adds no new destination.
- No secret may reach an error message, a log, the page, or the dashboard. The external message handler returns application records only — never settings, never `llm.apiKeys`, never the Notion token while it still exists.
- No API key in `.env`. `scripts/check-no-secrets.mjs` runs as part of `npm run build` and must keep passing.
- Nothing is written into a page or submitted without explicit user action.
- Every task ends green: `npx tsc --noEmit`, `npm run test -- --run`, `npm run build`.
- The fixture corpus must not regress: greenhouse 11/11, personio 6/6, ashby 6/6.
- Commit messages carry no `Co-Authored-By` trailer.
- Extension ID must be stable across reloads, or `externally_connectable` breaks on every rebuild. Task 6 pins it.

---

## File Structure

**New — extension**

| File | Responsibility |
|---|---|
| `extension/lib/application-db.ts` | IndexedDB open, upgrade, and the five record operations. The only file that knows IndexedDB exists. |
| `extension/lib/application-db.test.ts` | Tests for the above, against `fake-indexeddb`. |
| `extension/lib/application-record.ts` | The `ApplicationRecord` type, `emptyRecord`, and pure helpers over a list of records. No storage. |
| `extension/lib/application-record.test.ts` | Tests for the pure helpers. |
| `extension/lib/application-migrate.ts` | One-way move of the old `application-log` array into IndexedDB. |
| `extension/lib/application-migrate.test.ts` | Tests for the migration, including running it twice. |
| `extension/lib/dashboard-bridge.ts` | The external-message protocol: request and response types, and the allowlist of origins permitted to ask. |
| `extension/lib/dashboard-bridge.test.ts` | Tests that the allowlist rejects unknown origins and that no settings field can be returned. |

**New — dashboard**

| File | Responsibility |
|---|---|
| `dashboard/package.json` | Its own npm project. Not part of the extension build. |
| `dashboard/vite.config.ts` | Vite build to `dashboard/dist`. |
| `dashboard/index.html` | Page shell. |
| `dashboard/src/main.tsx` | Mount. |
| `dashboard/src/App.tsx` | Layout, list, and detail routing by selected id. |
| `dashboard/src/bridge.ts` | Talks to the extension. The only file that knows `chrome.runtime` exists. |
| `dashboard/src/ApplicationList.tsx` | Table of applications with status and score. |
| `dashboard/src/ApplicationDetail.tsx` | One application in full, including document download. |
| `dashboard/src/dashboard.css` | Styles, reusing the token names from the extension's `base.css`. |
| `dashboard/vercel.json` | Vercel build settings. |

**Modified — extension**

| File | Change |
|---|---|
| `extension/lib/application-log.ts` | Becomes a thin forwarder to `application-db.ts`, keeping `summarize` and the CSV export. Deleted in Task 12 once nothing imports it. |
| `extension/entrypoints/background.ts` | Adds the `onMessageExternal` listener; runs the migration on install. |
| `extension/entrypoints/review/ReviewPage.tsx` | On save, writes documents and tailoring detail onto the record. |
| `extension/components/HistorySections.tsx` | Reads records, adds a link to the dashboard. |
| `extension/wxt.config.ts` | Adds `key`, `externally_connectable`; later drops the Notion host permission. |
| `extension/lib/tab-state.ts` | Drops `notion`, in Task 12. |
| `extension/lib/settings.ts` | Drops `notion`, in Task 12. |

**Deleted in Task 12**

`extension/lib/notion-client.ts`, `extension/components/NotionSection.tsx`, and the Notion parts of `IntegrationSections.tsx`, `SetupView.tsx`, `DailyView.tsx`, `setup-groups.ts`.

---

## Task 1: The record type and its pure helpers

**Files:**
- Create: `extension/lib/application-record.ts`
- Test: `extension/lib/application-record.test.ts`

**Interfaces:**
- Consumes: `ApplicationEntry` from `extension/lib/application-log.ts` (existing, for the migration in Task 3).
- Produces: `ApplicationRecord`, `ApplicationStatus`, `STATUSES`, `StoredDocument`, `emptyRecord(seed)`, `summarize(records, now?)`, `ApplicationStats`, `wordingOutcomes(records)`.

- [ ] **Step 1: Write the failing test**

```ts
// extension/lib/application-record.test.ts
import { describe, expect, it } from 'vitest';
import { emptyRecord, summarize, wordingOutcomes, type ApplicationRecord } from './application-record';

const record = (over: Partial<ApplicationRecord> = {}): ApplicationRecord => ({
  ...emptyRecord({ company: 'Enpal', title: 'AI Intern', url: 'https://x/1', hostname: 'x' }),
  ...over,
});

describe('emptyRecord', () => {
  it('starts every application as applied, with nothing claimed that did not happen', () => {
    const r = emptyRecord({ company: 'Enpal', title: 'AI Intern', url: 'https://x/1', hostname: 'x' });
    expect(r.status).toBe('applied');
    expect(r.filledCount).toBe(0);
    expect(r.resume).toBeNull();
    expect(r.coverLetter).toBeNull();
    expect(r.variantIds).toEqual([]);
    expect(r.id).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('summarize', () => {
  it('counts replies as anything past applied, so one number says whether this works', () => {
    const stats = summarize([
      record({ status: 'applied' }),
      record({ status: 'rejected' }),
      record({ status: 'interview' }),
      record({ status: 'offer' }),
    ]);
    expect(stats.total).toBe(4);
    expect(stats.replied).toBe(3);
  });

  it('does not count a 31-day-old application as recent', () => {
    const now = 1_800_000_000_000;
    const old = now - 31 * 24 * 60 * 60 * 1000;
    expect(summarize([record({ appliedAt: old })], now).last30Days).toBe(0);
  });

  it('ranks the sites that reject what we write', () => {
    const stats = summarize([
      record({ hostname: 'a.com', invalidCount: 3 }),
      record({ hostname: 'b.com', invalidCount: 1 }),
      record({ hostname: 'a.com', invalidCount: 2 }),
    ]);
    expect(stats.troublesomeSites[0]).toEqual({ hostname: 'a.com', invalid: 5 });
  });
});

describe('wordingOutcomes', () => {
  it('reports how each bullet did, which is the thing Notion could never answer', () => {
    const outcomes = wordingOutcomes([
      record({ variantIds: ['v1', 'v2'], status: 'interview' }),
      record({ variantIds: ['v1'], status: 'rejected' }),
      record({ variantIds: ['v1'], status: 'applied' }),
    ]);
    const v1 = outcomes.find((o) => o.variantId === 'v1')!;
    expect(v1.sent).toBe(3);
    expect(v1.replied).toBe(2);
  });

  it('says nothing about a bullet never sent', () => {
    expect(wordingOutcomes([record({ variantIds: [] })])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run lib/application-record.test.ts`
Expected: FAIL — `Failed to resolve import "./application-record"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// extension/lib/application-record.ts
/**
 * One application, in full.
 *
 * The old log stored counts: how many fields were filled, whether Notion got a
 * row. It could not answer the question the tool exists to serve — which
 * wording actually gets replies — because it never recorded what was sent.
 * This does, and keeps both finished documents with it.
 */

/** What happened after applying. Set by hand; nothing else can know it. */
export type ApplicationStatus = 'applied' | 'replied' | 'interview' | 'rejected' | 'offer';

export const STATUSES: ApplicationStatus[] = ['applied', 'replied', 'interview', 'rejected', 'offer'];

/** Anything past `applied` is a reply, however it went. */
const REPLIED: ApplicationStatus[] = ['replied', 'interview', 'rejected', 'offer'];

/**
 * A document as it was sent.
 *
 * Bytes rather than a filename, so the record survives the documents folder
 * being cleaned, moved, or opened on another machine. Roughly 30-60KB each,
 * which IndexedDB carries without complaint and `storage.local` would not.
 */
export interface StoredDocument {
  filename: string;
  /** The .docx itself. */
  bytes: ArrayBuffer;
  savedAt: number;
}

export interface ApplicationRecord {
  id: string;
  appliedAt: number;
  company: string;
  title: string;
  url: string;
  hostname: string;
  status: ApplicationStatus;

  filledCount: number;
  /** Values written that the form rejected — worth knowing which sites do this. */
  invalidCount: number;
  questionsDrafted: number;
  documentsAttached: number;

  /** The posting itself, so the record stands alone once the page is gone. */
  jobDescription: string;
  matchScore: number | null;
  gapCovered: string[];
  gapMissing: string[];
  /** Bank variant ids of the exact bullets that went out. */
  variantIds: string[];
  /** Figures the model estimated rather than read, as shown in review. */
  estimatedFigures: string[];
  /** Model requests this application cost. */
  requestsSpent: number;

  resume: StoredDocument | null;
  coverLetter: StoredDocument | null;
}

export function emptyRecord(
  seed: Pick<ApplicationRecord, 'company' | 'title' | 'url' | 'hostname'>
): ApplicationRecord {
  return {
    id: crypto.randomUUID(),
    appliedAt: Date.now(),
    status: 'applied',
    filledCount: 0,
    invalidCount: 0,
    questionsDrafted: 0,
    documentsAttached: 0,
    jobDescription: '',
    matchScore: null,
    gapCovered: [],
    gapMissing: [],
    variantIds: [],
    estimatedFigures: [],
    requestsSpent: 0,
    resume: null,
    coverLetter: null,
    ...seed,
  };
}

export interface ApplicationStats {
  total: number;
  last30Days: number;
  replied: number;
  fieldsFilled: number;
  questionsDrafted: number;
  /** Sites where a written value was rejected, worst first. */
  troublesomeSites: Array<{ hostname: string; invalid: number }>;
}

export function summarize(records: ApplicationRecord[], now = Date.now()): ApplicationStats {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const byHost = new Map<string, number>();

  for (const r of records) {
    if (r.invalidCount > 0) byHost.set(r.hostname, (byHost.get(r.hostname) ?? 0) + r.invalidCount);
  }

  return {
    total: records.length,
    last30Days: records.filter((r) => r.appliedAt >= cutoff).length,
    replied: records.filter((r) => REPLIED.includes(r.status)).length,
    fieldsFilled: records.reduce((sum, r) => sum + r.filledCount, 0),
    questionsDrafted: records.reduce((sum, r) => sum + r.questionsDrafted, 0),
    troublesomeSites: [...byHost.entries()]
      .map(([hostname, invalid]) => ({ hostname, invalid }))
      .sort((a, b) => b.invalid - a.invalid)
      .slice(0, 5),
  };
}

export interface WordingOutcome {
  variantId: string;
  sent: number;
  replied: number;
}

/**
 * How each bullet has done.
 *
 * The whole reason for recording `variantIds`. With enough applications this
 * says which framing of a piece of work gets answered — something no amount of
 * counting filled fields could ever show.
 */
export function wordingOutcomes(records: ApplicationRecord[]): WordingOutcome[] {
  const sent = new Map<string, number>();
  const replied = new Map<string, number>();

  for (const r of records) {
    const isReply = REPLIED.includes(r.status);
    for (const id of r.variantIds) {
      sent.set(id, (sent.get(id) ?? 0) + 1);
      if (isReply) replied.set(id, (replied.get(id) ?? 0) + 1);
    }
  }

  return [...sent.entries()]
    .map(([variantId, count]) => ({ variantId, sent: count, replied: replied.get(variantId) ?? 0 }))
    .sort((a, b) => b.replied - a.replied || b.sent - a.sent);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npx vitest run lib/application-record.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/application-record.ts extension/lib/application-record.test.ts
git commit -m "Record what was sent, not just how many fields were filled"
```

---

## Task 2: The IndexedDB store

**Files:**
- Create: `extension/lib/application-db.ts`
- Test: `extension/lib/application-db.test.ts`
- Modify: `extension/package.json` (add `fake-indexeddb` to devDependencies)

**Interfaces:**
- Consumes: `ApplicationRecord` from Task 1.
- Produces: `putRecord(record)`, `patchRecord(id, patch)`, `getRecord(id)`, `listRecords()`, `deleteRecord(id)`, `clearRecords()`, `DB_NAME`, `DB_VERSION`.

- [ ] **Step 1: Install the test double**

```bash
cd extension && npm install --save-dev fake-indexeddb
```

- [ ] **Step 2: Write the failing test**

```ts
// extension/lib/application-db.test.ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearRecords, getRecord, listRecords, patchRecord, putRecord, deleteRecord } from './application-db';
import { emptyRecord } from './application-record';

const seed = (company: string) =>
  emptyRecord({ company, title: 'Engineer', url: `https://x/${company}`, hostname: 'x' });

beforeEach(async () => {
  await clearRecords();
});

describe('the application store', () => {
  it('reads back what it wrote', async () => {
    const r = seed('Enpal');
    await putRecord(r);
    expect((await getRecord(r.id))?.company).toBe('Enpal');
  });

  it('lists newest first, which is the order the dashboard shows', async () => {
    await putRecord({ ...seed('Older'), appliedAt: 1000 });
    await putRecord({ ...seed('Newer'), appliedAt: 2000 });
    expect((await listRecords()).map((r) => r.company)).toEqual(['Newer', 'Older']);
  });

  it('patches one field without touching the rest', async () => {
    const r = seed('Enpal');
    await putRecord(r);
    await patchRecord(r.id, { status: 'interview' });
    const after = await getRecord(r.id);
    expect(after?.status).toBe('interview');
    expect(after?.company).toBe('Enpal');
  });

  it('ignores a patch for an id that is not there', async () => {
    await expect(patchRecord('missing', { status: 'offer' })).resolves.toBeUndefined();
  });

  it('carries document bytes through a round trip', async () => {
    // The reason this is IndexedDB and not storage.local: a .docx is ~40KB and
    // storage.local holds ~10MB for the whole extension.
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const r = { ...seed('Enpal'), resume: { filename: 'a.docx', bytes, savedAt: 1 } };
    await putRecord(r);
    const back = await getRecord(r.id);
    expect(new Uint8Array(back!.resume!.bytes)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  });

  it('deletes one record', async () => {
    const r = seed('Enpal');
    await putRecord(r);
    await deleteRecord(r.id);
    expect(await getRecord(r.id)).toBeNull();
  });

  it('has nothing to say about an empty store', async () => {
    expect(await listRecords()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd extension && npx vitest run lib/application-db.test.ts`
Expected: FAIL — `Failed to resolve import "./application-db"`.

- [ ] **Step 4: Write minimal implementation**

```ts
// extension/lib/application-db.ts
import type { ApplicationRecord } from './application-record';

/**
 * Where applications live.
 *
 * IndexedDB rather than `storage.local` for two reasons that are both hard
 * limits rather than preferences: the old log was capped at 500 entries to stop
 * it crowding out the profile, and a record now carries two .docx files at
 * roughly 40KB each, which the ~10MB shared quota cannot hold. IndexedDB also
 * stores an ArrayBuffer as itself, so no base64 round trip is needed on the way
 * in or out.
 *
 * Every function here opens the database and closes over one transaction. No
 * connection is held between calls — a service worker is killed without warning
 * and a held handle is a handle that is gone when it is next used.
 */
export const DB_NAME = 'applyflow';
export const DB_VERSION = 1;
const STORE = 'applications';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        // The dashboard reads newest first and nothing else sorts, so this is
        // the only index worth carrying.
        store.createIndex('appliedAt', 'appliedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      })
  );
}

export async function putRecord(record: ApplicationRecord): Promise<void> {
  await run('readwrite', (store) => store.put(record) as IDBRequest<IDBValidKey>);
}

export async function getRecord(id: string): Promise<ApplicationRecord | null> {
  const found = await run<ApplicationRecord | undefined>('readonly', (store) => store.get(id));
  return found ?? null;
}

/** Newest first — the order the dashboard and the history panel both want. */
export async function listRecords(): Promise<ApplicationRecord[]> {
  const all = await run<ApplicationRecord[]>('readonly', (store) => store.getAll());
  return all.sort((a, b) => b.appliedAt - a.appliedAt);
}

/** Merges into an existing record. A missing id is a no-op, never an error:
 *  the caller is usually a later stage of a run whose record may be gone. */
export async function patchRecord(id: string, patch: Partial<ApplicationRecord>): Promise<void> {
  const current = await getRecord(id);
  if (!current) return;
  await putRecord({ ...current, ...patch, id: current.id });
}

export async function deleteRecord(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
}

export async function clearRecords(): Promise<void> {
  await run('readwrite', (store) => store.clear() as IDBRequest<undefined>);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd extension && npx vitest run lib/application-db.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add extension/lib/application-db.ts extension/lib/application-db.test.ts extension/package.json extension/package-lock.json
git commit -m "Move applications to IndexedDB so a record can carry its documents"
```

---

## Task 3: Migrate the existing log

**Files:**
- Create: `extension/lib/application-migrate.ts`
- Test: `extension/lib/application-migrate.test.ts`

**Interfaces:**
- Consumes: `listRecords`, `putRecord` from Task 2; `emptyRecord` from Task 1.
- Produces: `migrateApplicationLog(): Promise<number>` — returns how many entries moved.

- [ ] **Step 1: Write the failing test**

```ts
// extension/lib/application-migrate.test.ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateApplicationLog, LEGACY_KEY } from './application-migrate';
import { clearRecords, listRecords } from './application-db';

const legacy = {
  id: 'old-1',
  appliedAt: 1000,
  company: 'Enpal',
  title: 'AI Intern',
  url: 'https://x/1',
  hostname: 'x',
  filledCount: 11,
  invalidCount: 2,
  questionsDrafted: 3,
  documentsAttached: 1,
  loggedToNotion: true,
};

function stubStorage(initial: Record<string, unknown>) {
  const store = { ...initial };
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => Object.assign(store, items),
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
  });
  return store;
}

beforeEach(async () => {
  await clearRecords();
  vi.unstubAllGlobals();
});

describe('migrateApplicationLog', () => {
  it('moves an old entry across, keeping its id and counts', async () => {
    stubStorage({ [LEGACY_KEY]: [legacy] });
    expect(await migrateApplicationLog()).toBe(1);

    const [record] = await listRecords();
    expect(record!.id).toBe('old-1');
    expect(record!.filledCount).toBe(11);
    expect(record!.status).toBe('applied');
  });

  it('leaves the fields an old entry never had empty rather than inventing them', async () => {
    // An entry from before this existed has no job description and no
    // documents. Filling those with plausible defaults would be a lie the
    // dashboard then reports as fact.
    stubStorage({ [LEGACY_KEY]: [legacy] });
    await migrateApplicationLog();
    const [record] = await listRecords();
    expect(record!.jobDescription).toBe('');
    expect(record!.resume).toBeNull();
    expect(record!.matchScore).toBeNull();
  });

  it('runs twice without duplicating anything', async () => {
    const store = stubStorage({ [LEGACY_KEY]: [legacy] });
    await migrateApplicationLog();
    expect(await migrateApplicationLog()).toBe(0);
    expect(await listRecords()).toHaveLength(1);
    expect(store[LEGACY_KEY]).toBeUndefined();
  });

  it('does nothing when there was never an old log', async () => {
    stubStorage({});
    expect(await migrateApplicationLog()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run lib/application-migrate.test.ts`
Expected: FAIL — `Failed to resolve import "./application-migrate"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// extension/lib/application-migrate.ts
import { listRecords, putRecord } from './application-db';
import { emptyRecord, type ApplicationRecord } from './application-record';

/**
 * Moves the old `storage.local` log into IndexedDB, once.
 *
 * The old entries carry counts and nothing else — no job description, no
 * documents, no bullet ids, because none of that was recorded. Those fields
 * stay empty rather than being filled with defaults: a dashboard that shows an
 * invented score is worse than one that shows a blank.
 *
 * The old key is removed only after the write succeeds, so an interrupted
 * migration leaves the original data where it was.
 */
export const LEGACY_KEY = 'application-log';

interface LegacyEntry {
  id: string;
  appliedAt: number;
  company: string;
  title: string;
  url: string;
  hostname: string;
  filledCount: number;
  invalidCount: number;
  questionsDrafted: number;
  documentsAttached: number;
}

export async function migrateApplicationLog(): Promise<number> {
  const stored = await browser.storage.local.get(LEGACY_KEY);
  const entries = stored[LEGACY_KEY] as LegacyEntry[] | undefined;
  if (!Array.isArray(entries) || entries.length === 0) return 0;

  const existing = new Set((await listRecords()).map((r) => r.id));

  let moved = 0;
  for (const entry of entries) {
    if (existing.has(entry.id)) continue;
    const record: ApplicationRecord = {
      ...emptyRecord({
        company: entry.company,
        title: entry.title,
        url: entry.url,
        hostname: entry.hostname,
      }),
      id: entry.id,
      appliedAt: entry.appliedAt,
      filledCount: entry.filledCount ?? 0,
      invalidCount: entry.invalidCount ?? 0,
      questionsDrafted: entry.questionsDrafted ?? 0,
      documentsAttached: entry.documentsAttached ?? 0,
    };
    await putRecord(record);
    moved += 1;
  }

  await browser.storage.local.remove(LEGACY_KEY);
  return moved;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npx vitest run lib/application-migrate.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/application-migrate.ts extension/lib/application-migrate.test.ts
git commit -m "Carry the old application log into the new store without inventing fields"
```

---

## Task 4: The dashboard bridge protocol

**Files:**
- Create: `extension/lib/dashboard-bridge.ts`
- Test: `extension/lib/dashboard-bridge.test.ts`

**Interfaces:**
- Consumes: `ApplicationRecord`, `ApplicationStatus` from Task 1.
- Produces: `DashboardRequest`, `DashboardResponse`, `ALLOWED_ORIGINS`, `isAllowedOrigin(origin)`, `handleDashboardRequest(request, deps)`, `TransferableRecord`, `toTransferable(record)`.

- [ ] **Step 1: Write the failing test**

```ts
// extension/lib/dashboard-bridge.test.ts
import { describe, expect, it } from 'vitest';
import {
  handleDashboardRequest,
  isAllowedOrigin,
  toTransferable,
} from './dashboard-bridge';
import { emptyRecord } from './application-record';

const record = emptyRecord({ company: 'Enpal', title: 'AI Intern', url: 'https://x/1', hostname: 'x' });

const deps = {
  list: async () => [record],
  get: async (id: string) => (id === record.id ? record : null),
  patch: async () => {},
};

describe('isAllowedOrigin', () => {
  it('accepts the deployed dashboard and local development', () => {
    expect(isAllowedOrigin('https://applyflow-dashboard.vercel.app')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5174')).toBe(true);
  });

  it('refuses anything else, however close it looks', () => {
    // externally_connectable already restricts who can send, but a second
    // check here costs nothing and means a mistake in the manifest is not the
    // only thing standing between a page and this data.
    expect(isAllowedOrigin('https://applyflow-dashboard.vercel.app.evil.com')).toBe(false);
    expect(isAllowedOrigin('https://evil.com')).toBe(false);
    expect(isAllowedOrigin('')).toBe(false);
  });
});

describe('handleDashboardRequest', () => {
  it('lists applications', async () => {
    const response = await handleDashboardRequest({ type: 'list' }, deps);
    expect(response.ok).toBe(true);
    expect(response.ok && response.records![0]!.company).toBe('Enpal');
  });

  it('sends a list without document bytes, which would be megabytes', async () => {
    const heavy = { ...record, resume: { filename: 'a.docx', bytes: new ArrayBuffer(40_000), savedAt: 1 } };
    const response = await handleDashboardRequest({ type: 'list' }, { ...deps, list: async () => [heavy] });
    expect(response.ok && response.records![0]!.resume).toEqual({ filename: 'a.docx', savedAt: 1 });
  });

  it('sends bytes only for the one application asked for, base64 encoded', async () => {
    const bytes = new Uint8Array([0x50, 0x4b]).buffer;
    const heavy = { ...record, resume: { filename: 'a.docx', bytes, savedAt: 1 } };
    const response = await handleDashboardRequest(
      { type: 'get', id: record.id },
      { ...deps, get: async () => heavy }
    );
    expect(response.ok && response.record!.resume!.base64).toBe('UEs=');
  });

  it('accepts a status change, which is the only write the dashboard may make', async () => {
    let written: unknown = null;
    const response = await handleDashboardRequest(
      { type: 'set-status', id: record.id, status: 'interview' },
      { ...deps, patch: async (_id, p) => void (written = p) }
    );
    expect(response.ok).toBe(true);
    expect(written).toEqual({ status: 'interview' });
  });

  it('refuses a status that is not one of ours', async () => {
    const response = await handleDashboardRequest(
      { type: 'set-status', id: record.id, status: 'hired' as never },
      deps
    );
    expect(response.ok).toBe(false);
  });

  it('refuses a request type it does not know', async () => {
    const response = await handleDashboardRequest({ type: 'read-settings' } as never, deps);
    expect(response.ok).toBe(false);
  });
});

describe('what may never leave', () => {
  it('sends only the record fields, so no settings field can ride along', () => {
    // The dashboard is a web page. Anything this returns is readable by it, so
    // the shape is an allowlist rather than a redaction.
    const sneaky = { ...record, apiKey: 'sk-or-v1-secret', notionToken: 'secret' } as never;
    expect(Object.keys(toTransferable(sneaky))).not.toContain('apiKey');
    expect(Object.keys(toTransferable(sneaky))).not.toContain('notionToken');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run lib/dashboard-bridge.test.ts`
Expected: FAIL — `Failed to resolve import "./dashboard-bridge"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// extension/lib/dashboard-bridge.ts
import { STATUSES, type ApplicationRecord, type ApplicationStatus } from './application-record';

/**
 * What the dashboard may ask the extension, and what it gets back.
 *
 * The dashboard is a web page on someone else's host. It holds no data: it asks
 * for records and renders them. That makes this file the boundary, and the
 * boundary is built as an allowlist — the response is assembled field by field
 * from the record, never spread from an object that might carry more. A
 * redaction list would have to be updated every time a field is added; an
 * allowlist fails closed.
 *
 * Document bytes are sent only for a single application, and only when asked.
 * A list of fifty applications with two .docx files each would be four
 * megabytes through a message channel that serialises to JSON.
 */

export const ALLOWED_ORIGINS = [
  'https://applyflow-dashboard.vercel.app',
  'http://localhost:5174',
];

export function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.includes(origin);
}

/** A document in a list: named, but not carried. */
export interface DocumentSummary {
  filename: string;
  savedAt: number;
}

/** A document in a detail view: carried, base64 because the channel is JSON. */
export interface DocumentPayload extends DocumentSummary {
  base64: string;
}

export interface TransferableRecord {
  id: string;
  appliedAt: number;
  company: string;
  title: string;
  url: string;
  hostname: string;
  status: ApplicationStatus;
  filledCount: number;
  invalidCount: number;
  questionsDrafted: number;
  documentsAttached: number;
  jobDescription: string;
  matchScore: number | null;
  gapCovered: string[];
  gapMissing: string[];
  variantIds: string[];
  estimatedFigures: string[];
  requestsSpent: number;
  resume: DocumentSummary | null;
  coverLetter: DocumentSummary | null;
}

export interface DetailedRecord extends Omit<TransferableRecord, 'resume' | 'coverLetter'> {
  resume: DocumentPayload | null;
  coverLetter: DocumentPayload | null;
}

export type DashboardRequest =
  | { type: 'list' }
  | { type: 'get'; id: string }
  | { type: 'set-status'; id: string; status: ApplicationStatus };

/**
 * One success shape rather than three.
 *
 * Three members all carrying `ok: true` cannot be narrowed by `ok` alone, so
 * every caller would need `'records' in response` to get at anything. Optional
 * fields on one member narrow cleanly and read the same at the call site.
 */
export type DashboardResponse =
  | { ok: true; records?: TransferableRecord[]; record?: DetailedRecord | null }
  | { ok: false; error: string };

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked: String.fromCharCode(...bytes) overflows the call stack on a file
  // of any real size.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Field by field, so nothing that is not listed here can ever be sent. */
export function toTransferable(record: ApplicationRecord): TransferableRecord {
  return {
    id: record.id,
    appliedAt: record.appliedAt,
    company: record.company,
    title: record.title,
    url: record.url,
    hostname: record.hostname,
    status: record.status,
    filledCount: record.filledCount,
    invalidCount: record.invalidCount,
    questionsDrafted: record.questionsDrafted,
    documentsAttached: record.documentsAttached,
    jobDescription: record.jobDescription,
    matchScore: record.matchScore,
    gapCovered: record.gapCovered,
    gapMissing: record.gapMissing,
    variantIds: record.variantIds,
    estimatedFigures: record.estimatedFigures,
    requestsSpent: record.requestsSpent,
    resume: record.resume ? { filename: record.resume.filename, savedAt: record.resume.savedAt } : null,
    coverLetter: record.coverLetter
      ? { filename: record.coverLetter.filename, savedAt: record.coverLetter.savedAt }
      : null,
  };
}

function toDetailed(record: ApplicationRecord): DetailedRecord {
  const summary = toTransferable(record);
  return {
    ...summary,
    resume: record.resume
      ? { ...summary.resume!, base64: base64(record.resume.bytes) }
      : null,
    coverLetter: record.coverLetter
      ? { ...summary.coverLetter!, base64: base64(record.coverLetter.bytes) }
      : null,
  };
}

export interface BridgeDeps {
  list: () => Promise<ApplicationRecord[]>;
  get: (id: string) => Promise<ApplicationRecord | null>;
  patch: (id: string, patch: Partial<ApplicationRecord>) => Promise<void>;
}

export async function handleDashboardRequest(
  request: DashboardRequest,
  deps: BridgeDeps
): Promise<DashboardResponse> {
  switch (request?.type) {
    case 'list':
      return { ok: true, records: (await deps.list()).map(toTransferable) };

    case 'get': {
      const record = await deps.get(request.id);
      return { ok: true, record: record ? toDetailed(record) : null };
    }

    case 'set-status': {
      // The only write the dashboard is allowed. Everything else it shows is
      // produced by the extension while applying.
      if (!STATUSES.includes(request.status)) return { ok: false, error: 'Unknown status.' };
      await deps.patch(request.id, { status: request.status });
      return { ok: true };
    }

    default:
      return { ok: false, error: 'Unknown request.' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npx vitest run lib/dashboard-bridge.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/dashboard-bridge.ts extension/lib/dashboard-bridge.test.ts
git commit -m "Define what the dashboard may ask for, as an allowlist"
```

---

## Task 5: Wire the bridge into the background worker

**Files:**
- Modify: `extension/entrypoints/background.ts`

**Interfaces:**
- Consumes: `handleDashboardRequest`, `isAllowedOrigin` from Task 4; `listRecords`, `getRecord`, `patchRecord` from Task 2; `migrateApplicationLog` from Task 3.
- Produces: nothing importable. Registers `browser.runtime.onMessageExternal` and runs the migration on install.

- [ ] **Step 1: Add the listener and the migration**

Add near the other listeners inside `defineBackground(() => { ... })`:

```ts
  /*
   * The dashboard asks; the extension answers.
   *
   * The dashboard is a static page with no storage and no server behind it, so
   * every record it shows comes through here. Two gates, deliberately: the
   * manifest's `externally_connectable` decides who may send at all, and this
   * checks the origin again — a mistake in one should not be the only thing
   * between a web page and an application history.
   */
  browser.runtime.onMessageExternal.addListener(
    (request: DashboardRequest, sender, sendResponse: (response: DashboardResponse) => void) => {
      if (!sender.origin || !isAllowedOrigin(sender.origin)) {
        sendResponse({ ok: false, error: 'Not an allowed origin.' });
        return false;
      }

      void handleDashboardRequest(request, {
        list: listRecords,
        get: getRecord,
        patch: patchRecord,
      })
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: 'Could not read applications.' }));

      return true;
    }
  );

  // One-way, and a no-op after the first run. The old log is capped at 500
  // entries and cannot hold documents, so nothing is left behind on purpose.
  browser.runtime.onInstalled.addListener(() => {
    void migrateApplicationLog();
  });
```

Add the imports at the top:

```ts
import { handleDashboardRequest, isAllowedOrigin, type DashboardRequest, type DashboardResponse } from '@/lib/dashboard-bridge';
import { getRecord, listRecords, patchRecord } from '@/lib/application-db';
import { migrateApplicationLog } from '@/lib/application-migrate';
```

- [ ] **Step 2: Verify it compiles**

Run: `cd extension && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Run the whole suite**

Run: `cd extension && npm run test -- --run`
Expected: PASS, no regressions.

- [ ] **Step 4: Commit**

```bash
git add extension/entrypoints/background.ts
git commit -m "Answer the dashboard, and check the origin twice"
```

---

## Task 6: Pin the extension ID and declare the dashboard origin

**Files:**
- Modify: `extension/wxt.config.ts`

**Interfaces:**
- Consumes: `ALLOWED_ORIGINS` from Task 4 (the manifest must list the same origins).
- Produces: a stable extension ID, and `externally_connectable` in the built manifest.

- [ ] **Step 1: Generate a key pair for a stable ID**

```bash
cd extension && openssl genrsa -out ../applyflow-extension.pem 2048
openssl rsa -in ../applyflow-extension.pem -pubout -outform DER | openssl base64 -A
```

Copy the printed base64. Add `applyflow-extension.pem` to the repo's `.gitignore` — it is a signing key and must not be committed.

- [ ] **Step 2: Add the key and the connectable origins**

In `extension/wxt.config.ts`, inside `manifest`:

```ts
    /*
     * Pins the extension ID.
     *
     * Without this, an unpacked extension gets a new ID on every load, and
     * `externally_connectable` is keyed on that ID — so the dashboard would
     * lose its connection to the extension on every rebuild. The public half of
     * the key pair is safe to commit; the private half is in
     * applyflow-extension.pem, which is gitignored.
     */
    key: 'PASTE_BASE64_PUBLIC_KEY_HERE',

    /*
     * Which pages may message this extension. Nothing else can, whatever it
     * sends. The list matches ALLOWED_ORIGINS in lib/dashboard-bridge.ts; both
     * exist so that a mistake in either one alone is not enough.
     */
    externally_connectable: {
      matches: ['https://applyflow-dashboard.vercel.app/*', 'http://localhost:5174/*'],
    },
```

- [ ] **Step 3: Build and confirm the manifest**

Run: `cd extension && npm run build`
Then: `node -e "const m=require('./.output/chrome-mv3/manifest.json');console.log(m.externally_connectable, !!m.key)"`
Expected: the two matches printed, and `true`.

- [ ] **Step 4: Record the extension ID**

Load `extension/.output/chrome-mv3` unpacked in Brave, copy the ID from `brave://extensions`, and note it — Task 8 needs it.

- [ ] **Step 5: Commit**

```bash
git add extension/wxt.config.ts .gitignore
git commit -m "Pin the extension id so the dashboard can find it after a rebuild"
```

---

## Task 7: Record the whole application on save

**Files:**
- Modify: `extension/entrypoints/review/ReviewPage.tsx`
- Modify: `extension/components/FillSection.tsx`
- Test: `extension/lib/application-record.test.ts` (extend)

**Interfaces:**
- Consumes: `patchRecord` from Task 2; `ApplicationRecord` from Task 1; the existing `tabState.applicationId`.
- Produces: nothing importable. Fills `jobDescription`, `matchScore`, `gapCovered`, `gapMissing`, `variantIds`, `estimatedFigures`, `resume`, `coverLetter` on the record.

- [ ] **Step 1: Write the failing test**

Append to `extension/lib/application-record.test.ts`:

```ts
import { documentFromBlob } from './application-record';

describe('documentFromBlob', () => {
  it('keeps the bytes and the name it was saved under', async () => {
    // The filename matters as much as the bytes: saveToDocumentsFolder renames
    // on collision, so what is on disk may not be what was asked for.
    const blob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]);
    const doc = await documentFromBlob('Jordan_Avery_Resume_Enpal (1).docx', blob, 1234);
    expect(doc.filename).toBe('Jordan_Avery_Resume_Enpal (1).docx');
    expect(doc.savedAt).toBe(1234);
    expect(new Uint8Array(doc.bytes)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npx vitest run lib/application-record.test.ts`
Expected: FAIL — `documentFromBlob is not a function`.

- [ ] **Step 3: Add the helper**

Append to `extension/lib/application-record.ts`:

```ts
/**
 * A saved file, ready to store.
 *
 * `Blob.arrayBuffer()` is missing in jsdom, where the tests run, so the
 * FileReader path is the one that works in both places — the same reason
 * `resume-text.ts` reads files the way it does.
 */
export async function documentFromBlob(
  filename: string,
  blob: Blob,
  savedAt = Date.now()
): Promise<StoredDocument> {
  const bytes = await (typeof blob.arrayBuffer === 'function'
    ? blob.arrayBuffer()
    : new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      }));
  return { filename, bytes, savedAt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && npx vitest run lib/application-record.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the documents onto the record when review saves**

In `extension/entrypoints/review/ReviewPage.tsx`, inside `save()`, after `setSaved(names)`:

```ts
      /*
       * The record is the point of saving, not a side effect of it. Everything
       * that made this application what it is — the posting, the score, the
       * bullets that went out, the figures that were estimated, and both files
       * as bytes — is written here, where all of it is in hand at once.
       */
      const tabId = handoff.tabId;
      const applicationId = tabId === undefined ? undefined : (await getTabState(tabId)).applicationId;
      if (applicationId) {
        await patchRecord(applicationId, {
          jobDescription: handoff.jobDescription,
          matchScore: score,
          gapCovered: handoff.result.gap.covered.map((g) => g.term),
          gapMissing: handoff.result.gap.missing.map((g) => g.term),
          variantIds: bullets.map((b) => b.id),
          estimatedFigures: estimates,
          resume: resumeBlob ? await documentFromBlob(names[0]!, resumeBlob) : null,
          coverLetter: letterBlob && names[1] ? await documentFromBlob(names[1], letterBlob) : null,
        });
      }
```

The blobs are currently built inline inside the `saveToDocumentsFolder(...)` call
and thrown away. Hold them first. Replace the body of `save()` between
`const names: string[] = [];` and `setSaved(names);` with:

```ts
      // Held rather than passed straight through: the same bytes that go to the
      // documents folder go onto the record, and building them twice would let
      // the two copies drift.
      let resumeBlob: Blob | null = null;
      let letterBlob: Blob | null = null;

      if (combine && letterDocument) {
        const combinedBlob = await combinedToDocxBlob(document, letterDocument);
        resumeBlob = combinedBlob;
        names.push(
          await saveToDocumentsFolder(handle, combinedFilename(document, company), combinedBlob)
        );
      } else {
        resumeBlob = await toDocxBlob(document);
        names.push(await saveToDocumentsFolder(handle, resumeFilename(document, company), resumeBlob));

        if (letterDocument) {
          letterBlob = await coverLetterToDocxBlob(letterDocument);
          names.push(
            await saveToDocumentsFolder(handle, coverLetterFilename(document, company), letterBlob)
          );
        }
      }
```

`resumeBlob` holds the combined file in the combined case, which is correct: it
is the one document that was sent, and `names[0]` is the name it was saved
under.

`ReviewHandoff` has no `tabId`. Add it in `extension/lib/review-handoff.ts`:

```ts
export interface ReviewHandoff {
  result: TailorResult;
  letter: CoverLetterResult | null;
  company: string;
  role: string;
  jobDescription: string;
  createdAt: number;
  /** The tab this was built from, so the saved documents reach its record. */
  tabId?: number;
}
```

And set it in `extension/components/TailorCard.tsx` where `putReview` is called, passing `await getActiveTabId()`.

- [ ] **Step 6: Verify and commit**

Run: `cd extension && npx tsc --noEmit && npm run test -- --run && npm run build`
Expected: all pass.

```bash
git add extension/entrypoints/review/ReviewPage.tsx extension/lib/review-handoff.ts extension/components/TailorCard.tsx extension/lib/application-record.ts extension/lib/application-record.test.ts
git commit -m "Keep the posting, the bullets and both documents with the application"
```

---

## Task 8: The dashboard app

**Files:**
- Create: `dashboard/package.json`, `dashboard/vite.config.ts`, `dashboard/index.html`, `dashboard/tsconfig.json`
- Create: `dashboard/src/main.tsx`, `dashboard/src/bridge.ts`, `dashboard/src/App.tsx`, `dashboard/src/dashboard.css`

**Interfaces:**
- Consumes: the message protocol from Task 4 — `DashboardRequest`, `DashboardResponse`, `TransferableRecord`, `DetailedRecord`. These are re-declared in `dashboard/src/bridge.ts` rather than imported, because the dashboard is a separate npm project with no path into the extension.
- Produces: `askExtension(request)`, `EXTENSION_ID`.

- [ ] **Step 1: Scaffold the project**

```bash
mkdir -p dashboard/src && cd dashboard
npm init -y
npm install react react-dom
npm install --save-dev vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/chrome
```

- [ ] **Step 2: Write the config files**

`dashboard/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Must match the port in ALLOWED_ORIGINS and externally_connectable, or the
  // extension refuses to answer during development.
  server: { port: 5174 },
});
```

`dashboard/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ApplyFlow — Applications</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`dashboard/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["chrome"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the bridge**

`dashboard/src/bridge.ts`:

```ts
/**
 * The dashboard's only link to its data.
 *
 * There is no server and no database. Every record is held by the extension on
 * this machine, and this page asks for it over `chrome.runtime.sendMessage`.
 * That is the whole reason the dashboard can be a public URL without anything
 * of yours being on it: open it in a browser without the extension and it shows
 * nothing, because there is nothing there to show.
 *
 * The types below mirror lib/dashboard-bridge.ts in the extension. They are
 * copied rather than imported because this is a separate npm project; if you
 * change one, change both.
 */

/** Set by Task 6's pinned key. Replace with the id from brave://extensions. */
export const EXTENSION_ID = 'PASTE_EXTENSION_ID_HERE';

export type ApplicationStatus = 'applied' | 'replied' | 'interview' | 'rejected' | 'offer';
export const STATUSES: ApplicationStatus[] = ['applied', 'replied', 'interview', 'rejected', 'offer'];

export interface DocumentSummary {
  filename: string;
  savedAt: number;
}
export interface DocumentPayload extends DocumentSummary {
  base64: string;
}

export interface TransferableRecord {
  id: string;
  appliedAt: number;
  company: string;
  title: string;
  url: string;
  hostname: string;
  status: ApplicationStatus;
  filledCount: number;
  invalidCount: number;
  questionsDrafted: number;
  documentsAttached: number;
  jobDescription: string;
  matchScore: number | null;
  gapCovered: string[];
  gapMissing: string[];
  variantIds: string[];
  estimatedFigures: string[];
  requestsSpent: number;
  resume: DocumentSummary | null;
  coverLetter: DocumentSummary | null;
}

export interface DetailedRecord extends Omit<TransferableRecord, 'resume' | 'coverLetter'> {
  resume: DocumentPayload | null;
  coverLetter: DocumentPayload | null;
}

export type DashboardRequest =
  | { type: 'list' }
  | { type: 'get'; id: string }
  | { type: 'set-status'; id: string; status: ApplicationStatus };

export type DashboardResponse =
  | { ok: true; records?: TransferableRecord[]; record?: DetailedRecord | null }
  | { ok: false; error: string };

export class NoExtensionError extends Error {}

export function askExtension(request: DashboardRequest): Promise<DashboardResponse> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new NoExtensionError('ApplyFlow is not installed in this browser.'));
      return;
    }
    chrome.runtime.sendMessage(EXTENSION_ID, request, (response?: DashboardResponse) => {
      // An uninstalled or disabled extension sets lastError rather than
      // throwing, and reading it is what stops Chrome logging it as unchecked.
      if (chrome.runtime.lastError || !response) {
        reject(new NoExtensionError('ApplyFlow did not answer. Is it installed and enabled?'));
        return;
      }
      resolve(response);
    });
  });
}

/** Turns a base64 document back into something the browser will download. */
export function toBlobUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  );
}
```

- [ ] **Step 4: Write the app shell**

`dashboard/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './dashboard.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

`dashboard/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { askExtension, NoExtensionError, type TransferableRecord } from './bridge';
import { ApplicationList } from './ApplicationList';
import { ApplicationDetail } from './ApplicationDetail';

export function App() {
  const [records, setRecords] = useState<TransferableRecord[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    askExtension({ type: 'list' })
      .then((response) => {
        if (response.ok && response.records) setRecords(response.records);
        else setError('ApplyFlow refused the request.');
      })
      .catch((err) => setError(err instanceof NoExtensionError ? err.message : 'Could not reach ApplyFlow.'));
  };

  useEffect(refresh, []);

  if (error) {
    return (
      <main className="dash">
        <h1>ApplyFlow</h1>
        <p className="error">{error}</p>
        <p className="hint">
          This page holds nothing of its own. Every application it shows lives in the extension on your machine,
          so it needs ApplyFlow installed in this browser to show you anything.
        </p>
      </main>
    );
  }

  if (!records) return <main className="dash"><p className="hint">Reading your applications…</p></main>;

  return (
    <main className="dash">
      <h1>Applications</h1>
      {selected ? (
        <ApplicationDetail id={selected} onBack={() => setSelected(null)} onChanged={refresh} />
      ) : (
        <ApplicationList records={records} onOpen={setSelected} />
      )}
    </main>
  );
}
```

- [ ] **Step 5: Verify it builds**

Run: `cd dashboard && npx tsc --noEmit && npx vite build`
Expected: `dashboard/dist` written.

- [ ] **Step 6: Commit**

```bash
git add dashboard
git commit -m "Add a dashboard that holds no data of its own"
```

---

## Task 9: The list and the detail view

**Files:**
- Create: `dashboard/src/ApplicationList.tsx`
- Create: `dashboard/src/ApplicationDetail.tsx`
- Create: `dashboard/src/dashboard.css`

**Interfaces:**
- Consumes: `askExtension`, `toBlobUrl`, `STATUSES`, `TransferableRecord`, `DetailedRecord` from Task 8.
- Produces: `ApplicationList({ records, onOpen })`, `ApplicationDetail({ id, onBack, onChanged })`.

- [ ] **Step 1: Write the list**

`dashboard/src/ApplicationList.tsx`:

```tsx
import type { TransferableRecord } from './bridge';

const date = (ms: number) => new Date(ms).toLocaleDateString();

export function ApplicationList({
  records,
  onOpen,
}: {
  records: TransferableRecord[];
  onOpen: (id: string) => void;
}) {
  if (records.length === 0) {
    return <p className="hint">Nothing applied for yet. Fill an application and it appears here.</p>;
  }

  return (
    <table className="dash-table">
      <thead>
        <tr>
          <th>Company</th>
          <th>Role</th>
          <th>Applied</th>
          <th>Match</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.id} onClick={() => onOpen(r.id)} tabIndex={0}>
            <td>{r.company || r.hostname}</td>
            <td>{r.title}</td>
            <td>{date(r.appliedAt)}</td>
            <td>{r.matchScore ?? '—'}</td>
            <td><span className={`chip chip-${r.status}`}>{r.status}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Write the detail view**

`dashboard/src/ApplicationDetail.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { askExtension, toBlobUrl, STATUSES, type DetailedRecord, type ApplicationStatus } from './bridge';

export function ApplicationDetail({
  id,
  onBack,
  onChanged,
}: {
  id: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [record, setRecord] = useState<DetailedRecord | null>(null);

  useEffect(() => {
    void askExtension({ type: 'get', id }).then((r) => {
      if (r.ok && r.record) setRecord(r.record);
    });
  }, [id]);

  if (!record) return <p className="hint">Loading…</p>;

  const setStatus = async (status: ApplicationStatus) => {
    await askExtension({ type: 'set-status', id, status });
    setRecord({ ...record, status });
    onChanged();
  };

  return (
    <article className="dash-detail">
      <button type="button" onClick={onBack}>← All applications</button>

      <h2>{record.company} — {record.title}</h2>
      <p><a href={record.url} target="_blank" rel="noreferrer">{record.url}</a></p>

      <label>
        Status{' '}
        <select value={record.status} onChange={(e) => void setStatus(e.target.value as ApplicationStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <section>
        <h3>What was sent</h3>
        <ul>
          {/* Downloaded from bytes held on this machine. Nothing was uploaded
              to produce this link. */}
          {record.resume && (
            <li>
              <a href={toBlobUrl(record.resume.base64)} download={record.resume.filename}>
                {record.resume.filename}
              </a>
            </li>
          )}
          {record.coverLetter && (
            <li>
              <a href={toBlobUrl(record.coverLetter.base64)} download={record.coverLetter.filename}>
                {record.coverLetter.filename}
              </a>
            </li>
          )}
          {!record.resume && !record.coverLetter && <li className="hint">No documents recorded.</li>}
        </ul>
      </section>

      <section>
        <h3>Match</h3>
        <p>{record.matchScore === null ? 'Not scored.' : `${record.matchScore} / 100`}</p>
        <p className="hint">Covered: {record.gapCovered.join(', ') || '—'}</p>
        <p className="hint">Missing: {record.gapMissing.join(', ') || '—'}</p>
        {record.estimatedFigures.length > 0 && (
          <p className="hint">Estimated figures sent: {record.estimatedFigures.join(', ')}</p>
        )}
      </section>

      <section>
        <h3>The posting</h3>
        <pre className="dash-jd">{record.jobDescription || 'Not captured.'}</pre>
      </section>
    </article>
  );
}
```

- [ ] **Step 3: Write the styles**

`dashboard/src/dashboard.css` — reuse the extension's token names and the plum-magenta accent so the two surfaces read as one product:

```css
:root {
  --brand: #9e3389;
  --bg: #fafafa;
  --surface: #ffffff;
  --text: #0c0d0f;
  --text-muted: #6c727a;
  --border: #e4e6e9;
  --accent: var(--brand);
  --accent-bg: oklch(from var(--brand) 0.95 0.03 h);
  --sans: 'Geist Variable', -apple-system, 'Segoe UI', sans-serif;
}

:root:not([data-theme='light']) {
  @media (prefers-color-scheme: dark) {
    --bg: #0c0d0f;
    --surface: #131518;
    --text: #edeef0;
    --text-muted: #8c939b;
    --border: #23262b;
    --accent: oklch(from var(--brand) 0.73 c h);
    --accent-bg: oklch(from var(--brand) 0.24 0.045 h);
  }
}

body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); }
.dash { max-width: 1100px; margin: 0 auto; padding: 32px 24px 80px; }
.dash h1 { font-size: 20px; letter-spacing: -0.02em; }
.hint { color: var(--text-muted); font-size: 13px; }
.error { color: #b3261e; }

.dash-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.dash-table th { text-align: left; font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--text-muted); padding: 8px 10px; }
.dash-table td { padding: 10px; border-top: 1px solid var(--border); }
.dash-table tbody tr:hover { background: var(--accent-bg); cursor: pointer; }

.chip { padding: 2px 8px; border-radius: 999px; font-size: 11px; background: var(--accent-bg); color: var(--accent); }

.dash-detail section { margin-top: 24px; }
.dash-jd { white-space: pre-wrap; font-family: inherit; font-size: 13px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
```

- [ ] **Step 4: Verify**

Run: `cd dashboard && npx tsc --noEmit && npx vite build`
Expected: clean.

- [ ] **Step 5: Manual check against the real extension**

1. `cd dashboard && npx vite` — serves on `http://localhost:5174`.
2. Load `extension/.output/chrome-mv3` unpacked.
3. Paste the extension ID into `EXTENSION_ID` in `dashboard/src/bridge.ts`.
4. Open `http://localhost:5174`. Expected: the applications list, or "Nothing applied for yet."
5. Open the same URL in a browser without the extension. Expected: "ApplyFlow is not installed in this browser."

- [ ] **Step 6: Commit**

```bash
git add dashboard
git commit -m "Show the application, the documents and the posting it came from"
```

---

## Task 10: Deploy to Vercel

**Files:**
- Create: `dashboard/vercel.json`

- [ ] **Step 1: Write the Vercel config**

```json
{
  "buildCommand": "vite build",
  "outputDirectory": "dist",
  "framework": null
}
```

- [ ] **Step 2: Deploy**

```bash
cd dashboard && npx vercel --prod
```

Set the project root to `dashboard/` when prompted.

- [ ] **Step 3: Reconcile the deployed origin**

Vercel's assigned URL will not be `applyflow-dashboard.vercel.app` unless that name is free. Take the real URL and update **both** places, which must agree:

- `ALLOWED_ORIGINS` in `extension/lib/dashboard-bridge.ts`
- `externally_connectable.matches` in `extension/wxt.config.ts`

- [ ] **Step 4: Rebuild, reload, verify**

Run: `cd extension && npm run test -- --run && npm run build`

Reload the unpacked extension, open the deployed URL. Expected: the list renders. The origin test in `dashboard-bridge.test.ts` must be updated to the real host in the same commit.

- [ ] **Step 5: Commit**

```bash
git add dashboard/vercel.json extension/lib/dashboard-bridge.ts extension/lib/dashboard-bridge.test.ts extension/wxt.config.ts
git commit -m "Deploy the dashboard and point the extension at its real origin"
```

---

## Task 11: Point the extension at the dashboard

**Files:**
- Modify: `extension/components/HistorySections.tsx`

- [ ] **Step 1: Replace the history list with a link and a summary**

`ApplicationHistorySection` currently reads `getApplications()` and renders a table. Change it to read `listRecords()`, show `summarize()` output, and offer a link out:

```tsx
        {/* The panel is 400px. The dashboard is where this is actually read —
            the panel keeps the summary and hands over. */}
        <a className="btn" href={DASHBOARD_URL} target="_blank" rel="noreferrer">
          Open the dashboard
        </a>
```

with `const DASHBOARD_URL = 'https://<deployed-host>/';` at the top of the file.

- [ ] **Step 2: Verify and commit**

Run: `cd extension && npx tsc --noEmit && npm run test -- --run && npm run build`

```bash
git add extension/components/HistorySections.tsx
git commit -m "Hand the history off to the dashboard, keep the summary in the panel"
```

---

## Task 12: Delete Notion

**Files:**
- Delete: `extension/lib/notion-client.ts`, `extension/lib/notion-client.test.ts`, `extension/components/NotionSection.tsx`
- Modify: `extension/lib/settings.ts`, `extension/lib/tab-state.ts`, `extension/lib/setup-groups.ts`, `extension/components/IntegrationSections.tsx`, `extension/components/SetupView.tsx`, `extension/components/DailyView.tsx`, `extension/lib/application-log.ts`, `extension/wxt.config.ts`

**Do this last.** Until the dashboard has recorded a real application end to end, Notion is the only working tracker and removing it leaves a gap.

- [ ] **Step 1: Delete the files**

```bash
cd extension && rm lib/notion-client.ts lib/notion-client.test.ts components/NotionSection.tsx
```

- [ ] **Step 2: Remove the references**

- `lib/settings.ts` — drop `notion` from the `Settings` interface, from `EMPTY_SETTINGS`, and from `applySettingsDefaults`.
- `lib/tab-state.ts` — drop `notion?: { loggedUrl: string }`.
- `lib/setup-groups.ts` — drop the Notion entry.
- `components/IntegrationSections.tsx` — drop `NotionSettingsSection`.
- `components/SetupView.tsx` — drop the Notion step and its `notion` state.
- `components/DailyView.tsx` — drop `<LogToNotionSection />`.
- `lib/application-log.ts` — delete the file; nothing imports it after Task 11. Confirm with `grep -rn "application-log" --include=*.ts --include=*.tsx .`

- [ ] **Step 3: Drop the host permission and fix the description**

In `extension/wxt.config.ts`: remove `'https://api.notion.com/*'` from `host_permissions`, and change `description` to end `"…autofill, document attach, AI drafts, and a dashboard of everything you have applied to."`

- [ ] **Step 4: Verify nothing is left**

```bash
cd extension && grep -rin "notion" --include=*.ts --include=*.tsx --include=*.json . | grep -v node_modules | grep -v '\.output' | grep -v '\.wxt'
```

Expected: only `lib/application-record.ts` if a comment mentions the history, and `docs/`. No code.

- [ ] **Step 5: Run everything**

Run: `cd extension && npx tsc --noEmit && npm run test -- --run && npm run build`
Expected: all pass, no credentials found in build output, corpus at greenhouse 11/11, personio 6/6, ashby 6/6.

- [ ] **Step 6: Commit**

```bash
git add -A extension
git commit -m "Remove Notion

The dashboard records everything the Notion row did and more — the posting,
the exact bullets sent, both documents as bytes. Notion needed a token, a
database set up by hand, a host permission, and a network destination for data
that never had to leave the machine.

Deletes notion-client.ts, NotionSection.tsx, the settings and tab-state
fields, the setup step and the api.notion.com host permission."
```

---

## Task 13: Update the store listing

**Files:**
- Modify: `docs/store-listing.md`, `README.md`

- [ ] **Step 1: Rewrite the affected sections**

In `docs/store-listing.md`: remove Notion from the feature list and the permission justifications; remove the `api.notion.com` justification; add one for the dashboard origin explaining that `externally_connectable` lets a named page **ask** the extension for data and that nothing is sent anywhere.

The data-handling disclosure does not change, and that is the point worth stating plainly in the listing: the dashboard adds no server, no account and no new destination.

In `README.md`: replace the Notion tracking bullet with the dashboard.

- [ ] **Step 2: Commit**

```bash
git add docs/store-listing.md README.md
git commit -m "Say what the dashboard is and what it does not send"
```

---

## Verification

**Automated, after every task:** `npx tsc --noEmit`, `npm run test -- --run`, `npm run build`. The corpus holds at greenhouse 11/11, personio 6/6, ashby 6/6.

**Manual, and this is the real gate:**

1. Fill a real application. Tailor a resume and a letter. Save both from the review tab.
2. Open the dashboard. The application is there, with the score, the posting, and both files downloadable.
3. Download the resume from the dashboard. Open it. It is the document that was sent.
4. Set the status to `interview`. Reload. It stuck.
5. Open the dashboard URL in a browser **without** ApplyFlow installed. It says the extension is not installed and shows nothing.
6. Open dev tools on the dashboard, run `chrome.runtime.sendMessage(EXTENSION_ID, {type:'read-settings'})`. Expected: `{ok: false, error: 'Unknown request.'}` — no settings, no key.

Step 6 is the one that matters most. The dashboard is a public URL, and the only thing standing between it and everything else in the extension is the allowlist in `dashboard-bridge.ts`.

## Notes and risks

- **`externally_connectable` is keyed on the extension ID.** Task 6 pins it with `key`. Skip that and the dashboard breaks on every rebuild, silently, in a way that looks like the dashboard being broken rather than the ID having moved.
- **Document bytes are sent base64 over a JSON channel.** Fine for one application at ~55KB encoded per file; that is why the list never carries them. If a record ever needs to carry a PDF as well, revisit before adding it.
- **Records are never deleted automatically.** The old log capped at 500 to protect a shared quota; IndexedDB has no such pressure, so nothing ages out. If storage becomes a real problem, add a manual clear before adding an automatic one — this is the only copy of what was sent.
- **The private key in `applyflow-extension.pem` must never be committed.** It is the extension's identity. `scripts/check-no-secrets.mjs` should be extended to fail on a committed `.pem`.
