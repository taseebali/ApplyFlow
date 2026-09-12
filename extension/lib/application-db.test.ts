import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('keeps both fields when two patches race', async () => {
    // Two callers (review page, dashboard) can patch the same record without
    // awaiting each other. If get+put aren't one transaction, both reads see
    // the pre-patch record and whichever write lands second wins outright,
    // silently dropping the other field.
    const r = seed('Enpal');
    await putRecord(r);
    await Promise.all([patchRecord(r.id, { status: 'interview' }), patchRecord(r.id, { filledCount: 5 })]);
    const after = await getRecord(r.id);
    expect(after?.status).toBe('interview');
    expect(after?.filledCount).toBe(5);
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

  it('does not call a write done until its transaction commits', async () => {
    // A put reports success inside the transaction, long before the data is
    // durable. If the transaction then aborts — a full disk, or the quota
    // gone on two 40KB .docx files — the caller has already been told the
    // application was saved, and nothing ever corrects it.
    // Aborted *after* the put reports success, which is the window the bug
    // lived in: aborting earlier would fail the request itself and be caught
    // either way.
    const realPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      const request = realPut.apply(this, args);
      request.addEventListener('success', () => request.transaction!.abort());
      return request;
    });

    const r = seed('Enpal');
    await expect(putRecord(r)).rejects.toBeTruthy();
    spy.mockRestore();

    expect(await getRecord(r.id)).toBeNull();
  });

  it('does not let a failed request block the next one', async () => {
    const r = seed('Enpal');
    await putRecord(r);

    // Abort the transaction right after its request is queued — the same
    // event a real failed request produces (onabort, no oncomplete). Only
    // closing the connection on oncomplete would leak it here.
    const realTransaction = IDBDatabase.prototype.transaction;
    const spy = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const tx = realTransaction.apply(this, args);
      queueMicrotask(() => tx.abort());
      return tx;
    });

    await expect(getRecord(r.id)).rejects.toBeTruthy();
    spy.mockRestore();

    await expect(getRecord(r.id)).resolves.toMatchObject({ company: 'Enpal' });
  });
});
