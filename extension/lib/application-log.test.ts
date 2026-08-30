import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearApplications,
  getApplications,
  recordApplication,
  summarize,
  toCsv,
  type ApplicationEntry,
} from './application-log';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
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
});

const base = {
  company: 'Raisin',
  title: 'Operations',
  url: 'https://example.com/job',
  hostname: 'example.com',
  filledCount: 12,
  invalidCount: 0,
  questionsDrafted: 4,
  documentsAttached: 2,
  loggedToNotion: false,
};

describe('recording applications', () => {
  it('keeps the newest first', async () => {
    await recordApplication({ ...base, company: 'First' });
    await recordApplication({ ...base, company: 'Second' });
    expect((await getApplications())[0]!.company).toBe('Second');
  });

  it('can be cleared', async () => {
    await recordApplication(base);
    await clearApplications();
    expect(await getApplications()).toEqual([]);
  });
});

describe('summarize', () => {
  const now = Date.parse('2026-08-31T12:00:00Z');
  const at = (daysAgo: number, over: Partial<ApplicationEntry> = {}): ApplicationEntry => ({
    id: String(Math.random()),
    appliedAt: now - daysAgo * 24 * 60 * 60 * 1000,
    ...base,
    ...over,
  });

  it('counts recent applications separately from all time', () => {
    const stats = summarize([at(1), at(10), at(90)], now);
    expect(stats.total).toBe(3);
    expect(stats.last30Days).toBe(2);
  });

  it('adds up the work actually done', () => {
    const stats = summarize([at(1), at(2)], now);
    expect(stats.fieldsFilled).toBe(24);
    expect(stats.questionsDrafted).toBe(8);
  });

  it('names the sites whose forms keep rejecting values', () => {
    const stats = summarize(
      [
        at(1, { hostname: 'bad.example', invalidCount: 3 }),
        at(2, { hostname: 'bad.example', invalidCount: 2 }),
        at(3, { hostname: 'fine.example', invalidCount: 0 }),
      ],
      now
    );
    expect(stats.troublesomeSites[0]).toEqual({ hostname: 'bad.example', invalid: 5 });
    expect(stats.troublesomeSites.map((s) => s.hostname)).not.toContain('fine.example');
  });
});

describe('toCsv', () => {
  const entry: ApplicationEntry = { id: 'a', appliedAt: Date.parse('2026-08-31T12:00:00Z'), ...base };

  it('writes a header and one row per application', () => {
    const lines = toCsv([entry]).split('\n');
    expect(lines[0]).toContain('company');
    expect(lines[1]).toContain('Raisin');
  });

  it('escapes quotes rather than breaking the row', () => {
    expect(toCsv([{ ...entry, company: 'A "quoted" name' }])).toContain('"A ""quoted"" name"');
  });

  it('neutralises a value a spreadsheet would run as a formula', () => {
    // A company name starting with "=" is executed by Excel on open.
    expect(toCsv([{ ...entry, company: '=cmd()' }])).toContain(`"'=cmd()"`);
  });
});
