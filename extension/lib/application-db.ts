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
