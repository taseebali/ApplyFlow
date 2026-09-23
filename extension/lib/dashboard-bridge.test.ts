import { describe, expect, it } from 'vitest';
import { handleDashboardRequest, readProperties, toTransferable } from './dashboard-bridge';
import { emptyRecord } from './application-record';

const record = emptyRecord({ company: 'Enpal', title: 'AI Intern', url: 'https://x/1', hostname: 'x' });

const deps = {
  list: async () => [record],
  get: async (id: string) => (id === record.id ? record : null),
  patch: async () => {},
};

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

  it('accepts a property change, which is the only write the dashboard may make', async () => {
    let written: unknown = null;
    const response = await handleDashboardRequest(
      { type: 'set-properties', id: record.id, properties: { status: 'interview', priority: 'high' } },
      { ...deps, patch: async (_id, p) => void (written = p) }
    );
    expect(response.ok).toBe(true);
    expect(written).toEqual({ status: 'interview', priority: 'high' });
  });

  it('refuses a request whose properties are all invalid, rather than writing nothing', async () => {
    let called = false;
    const response = await handleDashboardRequest(
      { type: 'set-properties', id: record.id, properties: { status: 'hired' as never } },
      { ...deps, patch: async () => void (called = true) }
    );
    expect(response.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('writes the valid half of a mixed patch and drops the rest', async () => {
    let written: unknown = null;
    const response = await handleDashboardRequest(
      { type: 'set-properties', id: record.id, properties: { status: 'offer', priority: 'urgent' as never } },
      { ...deps, patch: async (_id, p) => void (written = p) }
    );
    expect(response.ok).toBe(true);
    expect(written).toEqual({ status: 'offer' });
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
    const sneaky = { ...record, apiKey: 'sk-or-v1-secret', authToken: 'secret' } as never;
    expect(Object.keys(toTransferable(sneaky))).not.toContain('apiKey');
    expect(Object.keys(toTransferable(sneaky))).not.toContain('authToken');
  });
});

describe('readProperties', () => {
  it('reads only the fields a person edits, whatever else was sent', () => {
    // The page is on another origin. A patch naming `resume` or `filledCount`
    // must not reach the record: those describe what actually went out.
    const patch = readProperties({
      status: 'offer',
      resume: null,
      filledCount: 9999,
      id: 'somebody-elses-id',
    });
    expect(patch).toEqual({ status: 'offer' });
  });

  it('caps a tag list, so the dashboard cannot use the record as storage', () => {
    const many = Array.from({ length: 40 }, (_, i) => `tag-${i}`);
    expect(readProperties({ tags: many }).tags).toHaveLength(12);
    expect(readProperties({ tags: ['x'.repeat(500)] }).tags).toEqual(['x'.repeat(32)]);
  });

  it('folds duplicate tags by case and keeps the first spelling', () => {
    expect(readProperties({ tags: ['Remote', 'remote', ' REMOTE '] }).tags).toEqual(['Remote']);
  });

  it('drops empty tags rather than storing blanks', () => {
    expect(readProperties({ tags: ['', '   ', 'Berlin'] }).tags).toEqual(['Berlin']);
  });

  it('strips control and bidi characters, which render as one thing and sort as another', () => {
    expect(readProperties({ nextAction: 'Follow‮up' }).nextAction).toBe('Followup');
    expect(readProperties({ salary: '​65k' }).salary).toBe('65k');
  });

  it('caps free text', () => {
    expect(readProperties({ nextAction: 'n'.repeat(1000) }).nextAction).toHaveLength(200);
    expect(readProperties({ salary: 's'.repeat(1000) }).salary).toHaveLength(60);
  });

  it('takes a due date as a whole number of milliseconds, or nothing', () => {
    expect(readProperties({ nextActionAt: 1_700_000_000_123.7 }).nextActionAt).toBe(1_700_000_000_123);
    expect(readProperties({ nextActionAt: null }).nextActionAt).toBeNull();
    // NaN survives a JSON round trip as null and would sort a board wrongly.
    expect(readProperties({ nextActionAt: NaN })).toEqual({});
    expect(readProperties({ nextActionAt: Infinity })).toEqual({});
    expect(readProperties({ nextActionAt: '2026-01-01' })).toEqual({});
  });

  it('reads nothing out of a non-object', () => {
    expect(readProperties(null)).toEqual({});
    expect(readProperties('status=offer')).toEqual({});
    expect(readProperties(undefined)).toEqual({});
  });
});
