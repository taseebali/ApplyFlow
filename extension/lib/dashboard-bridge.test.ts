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
  it('accepts the local dev server, which is all a dev build trusts', () => {
    // Tests run as a development build, so this is the whole list.
    expect(import.meta.env.DEV).toBe(true);
    expect(isAllowedOrigin('http://localhost:5174')).toBe(true);
  });

  it('trusts no host nobody has deployed', () => {
    // The vercel.app subdomain this once listed was never registered, so the
    // allowlist named a page any stranger could have claimed and served.
    expect(isAllowedOrigin('https://applyflow-dashboard.vercel.app')).toBe(false);
  });

  it('refuses anything else, however close it looks', () => {
    // externally_connectable already restricts who can send, but a second
    // check here costs nothing and means a mistake in the manifest is not the
    // only thing standing between a page and this data.
    expect(isAllowedOrigin('http://localhost:5174.evil.com')).toBe(false);
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
    const sneaky = { ...record, apiKey: 'sk-or-v1-secret', authToken: 'secret' } as never;
    expect(Object.keys(toTransferable(sneaky))).not.toContain('apiKey');
    expect(Object.keys(toTransferable(sneaky))).not.toContain('authToken');
  });
});
