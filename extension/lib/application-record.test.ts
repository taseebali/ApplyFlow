import { describe, expect, it } from 'vitest';
import { documentFromBlob, emptyRecord, summarize, wordingOutcomes, type ApplicationRecord } from './application-record';

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
