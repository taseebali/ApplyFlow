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
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * One transaction, settled when it commits.
 *
 * `request.onsuccess` fires inside the transaction, not on commit: a write
 * that resolved there had already told the caller it succeeded when the
 * transaction went on to abort — which is exactly what quota exhaustion on an
 * 80KB pair of .docx files looks like. Settling on `oncomplete` instead means
 * a resolved write is a committed one.
 */
function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        // Read at commit rather than in an onsuccess handler, which would also
        // overwrite any handler `work` set for itself.
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        // A failed request aborts its transaction, so this is also where a
        // request error lands. Closing here too: oncomplete never fires for an
        // aborted transaction, and the connection would be held indefinitely.
        tx.onabort = () => {
          db.close();
          // An abort with no error of its own still has to reject with
          // something: a caller that catches `undefined` cannot say what went
          // wrong, and every message here ends up in front of the user.
          reject(tx.error ?? request.error ?? new Error('The write was rolled back.'));
        };
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
 *  the caller is usually a later stage of a run whose record may be gone.
 *
 *  Get and put share one transaction rather than being two calls to `run` —
 *  two callers patching the same record concurrently would otherwise each
 *  read the pre-patch record and one write would silently clobber the
 *  other's fields. A single transaction serialises against any other
 *  transaction touching this store, so the second patch always reads the
 *  first one's result. */
export async function patchRecord(id: string, patch: Partial<ApplicationRecord>): Promise<void> {
  await run<ApplicationRecord | undefined>('readwrite', (store) => {
    const request = store.get(id) as IDBRequest<ApplicationRecord | undefined>;
    request.onsuccess = () => {
      const current = request.result;
      if (current) store.put({ ...current, ...patch, id: current.id });
    };
    return request;
  });
}

export async function deleteRecord(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
}

export async function clearRecords(): Promise<void> {
  await run('readwrite', (store) => store.clear() as IDBRequest<undefined>);
}
