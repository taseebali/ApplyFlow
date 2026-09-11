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
