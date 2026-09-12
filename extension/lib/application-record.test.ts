import { describe, expect, it } from 'vitest';
import {
  documentFromBlob,
  emptyRecord,
  recordForFill,
  summarize,
  toCsv,
  wordingOutcomes,
  type ApplicationRecord,
} from './application-record';

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

describe('recordForFill', () => {
  const frame = (over: { hostname?: string; filledCount?: number; invalid?: unknown[] } = {}) => ({
    hostname: 'boards.greenhouse.io',
    filledCount: 4,
    invalid: [],
    ...over,
  });

  it('makes a record for a posting that has none yet', () => {
    const r = recordForFill({ company: 'Enpal', title: 'AI Intern', url: 'https://x/1' }, [frame()]);
    expect(r.company).toBe('Enpal');
    expect(r.hostname).toBe('boards.greenhouse.io');
    expect(r.filledCount).toBe(4);
    expect(r.status).toBe('applied');
  });

  it('adds up the frames of one embedded application', () => {
    const r = recordForFill({ company: 'Enpal', title: '', url: '' }, [
      frame({ filledCount: 4, invalid: ['phone'] }),
      frame({ filledCount: 3, invalid: ['start date', 'salary'] }),
    ]);
    expect(r.filledCount).toBe(7);
    expect(r.invalidCount).toBe(3);
  });

  it('adds to the record this posting already has, never a second one', () => {
    // The case that would otherwise double every total and count the same
    // bullets twice in wordingOutcomes — and orphan the record holding the
    // documents and the score.
    const first = recordForFill({ company: 'Enpal', title: 'AI Intern', url: 'https://x/1' }, [frame()]);
    const withWork = { ...first, variantIds: ['v1'], documentsAttached: 2 };
    const second = recordForFill({ company: 'Enpal', title: 'AI Intern', url: 'https://x/1' }, [frame()], withWork);

    expect(second.id).toBe(first.id);
    expect(second.filledCount).toBe(8);
    expect(second.variantIds).toEqual(['v1']);
    expect(second.documentsAttached).toBe(2);
  });

  it('fills in a company the first page of the flow could not read', () => {
    const first = recordForFill({ company: '', title: '', url: '' }, [frame()]);
    const second = recordForFill({ company: 'Enpal', title: 'AI Intern', url: 'https://x/1' }, [frame()], first);
    expect(second.company).toBe('Enpal');
    expect(second.title).toBe('AI Intern');
  });

  it('keeps what was already known when a later page reads nothing', () => {
    const first = recordForFill({ company: 'Enpal', title: 'AI Intern', url: 'https://x/1' }, [frame()]);
    const second = recordForFill({ company: '', title: '', url: '' }, [frame()], first);
    expect(second.company).toBe('Enpal');
  });

  it('reuses the record when the same posting is filled twice, tracking parameter and all', () => {
    // A page revisited from a different link can pick up a fresh utm_source
    // between fills. Comparing the raw string would misread that as a second
    // posting and orphan the first record's documents and score.
    const first = recordForFill(
      { company: 'Enpal', title: 'AI Intern', url: 'https://boards.greenhouse.io/enpal/jobs/1' },
      [frame()]
    );
    const second = recordForFill(
      { company: 'Enpal', title: 'AI Intern', url: 'https://boards.greenhouse.io/enpal/jobs/1?utm_source=li' },
      [frame()],
      first
    );
    expect(second.id).toBe(first.id);
    expect(second.filledCount).toBe(8);
  });

  it('starts a new record when a second posting is filled in the same tab', () => {
    // This is the case a stale tab-state applicationId gets wrong: an
    // iframe-embedded application, or a URL isJobUrl does not recognise,
    // never clears the tab's stored id, so `existing` here is posting A's
    // record even though the tab has moved on to posting B. Landing B's
    // counts and identity on A's record — and later having ReviewPage
    // overwrite A's documents and score with B's — is exactly the bug this
    // guards against.
    const first = recordForFill(
      { company: 'Enpal', title: 'AI Intern', url: 'https://boards.greenhouse.io/enpal/jobs/1' },
      [frame()]
    );
    const second = recordForFill(
      { company: 'Other Co', title: 'Backend Engineer', url: 'https://boards.greenhouse.io/otherco/jobs/2' },
      [frame({ filledCount: 5 })],
      first
    );

    expect(second.id).not.toBe(first.id);
    expect(second.company).toBe('Other Co');
    expect(second.title).toBe('Backend Engineer');
    expect(second.filledCount).toBe(5);
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
  it('reports how each bullet did, which the old log could never answer', () => {
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

describe('toCsv', () => {
  it('guards each of the four formula-injection prefixes independently', () => {
    const prefixes = ['=', '+', '-', '@'];
    for (const prefix of prefixes) {
      const rows = toCsv([record({ company: `${prefix}formula` })]).split('\n');
      expect(rows[1]).toContain(`"'${prefix}formula"`);
    }
  });

  it('escapes double quotes, commas, and newlines in CSV fields', () => {
    const csv = toCsv([record({ company: 'hello"world,test\nvalue' })]);
    // Double quotes are escaped by doubling, field is wrapped in quotes.
    // Commas and newlines are preserved; the field stays quoted.
    expect(csv).toContain(`"hello""world,test\nvalue"`);
  });

  it('keeps the fields worth exporting, including ones the old log never had', () => {
    const csv = toCsv([record({ status: 'interview', matchScore: 0.82, estimatedFigures: ['a', 'b'] })]);
    const [header, row] = csv.split('\n');
    expect(header).toContain('status');
    expect(header).toContain('matchScore');
    expect(header).toContain('estimatedFigures');
    expect(row).toContain('"interview"');
    expect(row).toContain('"0.82"');
    expect(row).toContain('"2"');
  });

  it('never puts the job posting or document bytes in a cell', () => {
    const csv = toCsv([record({ jobDescription: 'a very long posting'.repeat(50) })]);
    expect(csv).not.toContain('very long posting');
    expect(csv.split('\n')[0]).not.toContain('jobDescription');
    expect(csv.split('\n')[0]).not.toContain('resume');
    expect(csv.split('\n')[0]).not.toContain('coverLetter');
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
