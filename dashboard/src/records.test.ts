import { describe, expect, it } from 'vitest';
import type { TransferableRecord } from './bridge';
import {
  EMPTY_QUERY,
  allTags,
  applyQuery,
  defaultDirectionFor,
  fromDateInput,
  groupByStatus,
  matchesSearch,
  summarize,
  toDateInput,
  weeklyVolume,
} from './records';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 17, 12);

const record = (over: Partial<TransferableRecord> = {}): TransferableRecord => ({
  id: Math.random().toString(36).slice(2),
  appliedAt: NOW,
  company: 'Enpal',
  title: 'AI Intern',
  url: 'https://enpal.de/jobs/1',
  hostname: 'enpal.de',
  status: 'applied',
  priority: 'none',
  tags: [],
  nextAction: '',
  nextActionAt: null,
  salary: '',
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
  ...over,
});

describe('matchesSearch', () => {
  it('reaches the posting itself, which is the only field that can answer "who wanted Rust"', () => {
    const r = record({ jobDescription: 'You will write Rust and some Python.' });
    expect(matchesSearch(r, 'rust')).toBe(true);
  });

  it('matches each word anywhere, in any order, rather than the whole phrase', () => {
    const r = record({ company: 'GitLab', title: 'Backend Engineer' });
    expect(matchesSearch(r, 'engineer gitlab')).toBe(true);
    expect(matchesSearch(r, 'gitlab frontend')).toBe(false);
  });

  it('searches tags and the next action, which is where a note about a record lives', () => {
    const r = record({ tags: ['Remote'], nextAction: 'Chase the recruiter' });
    expect(matchesSearch(r, 'remote')).toBe(true);
    expect(matchesSearch(r, 'recruiter')).toBe(true);
  });

  it('is empty-search-safe, so a cleared box shows everything', () => {
    expect(matchesSearch(record(), '')).toBe(true);
    expect(matchesSearch(record(), '   ')).toBe(true);
  });
});

describe('applyQuery filters', () => {
  const applied = record({ status: 'applied', tags: ['Berlin'] });
  const offer = record({ status: 'offer', priority: 'high', tags: ['Berlin', 'Remote'] });

  it('shows everything when nothing is selected', () => {
    expect(applyQuery([applied, offer], EMPTY_QUERY)).toHaveLength(2);
  });

  it('treats several statuses as "any of these"', () => {
    const result = applyQuery([applied, offer], { ...EMPTY_QUERY, statuses: ['offer'] });
    expect(result).toEqual([offer]);
  });

  it('requires every selected tag, because two clicks should narrow and not widen', () => {
    expect(applyQuery([applied, offer], { ...EMPTY_QUERY, tags: ['Berlin'] })).toHaveLength(2);
    expect(applyQuery([applied, offer], { ...EMPTY_QUERY, tags: ['Berlin', 'Remote'] })).toEqual([offer]);
  });

  it('combines a filter with a search rather than choosing between them', () => {
    const other = record({ status: 'offer', company: 'GitLab' });
    const result = applyQuery([offer, other], { ...EMPTY_QUERY, statuses: ['offer'], search: 'gitlab' });
    expect(result).toEqual([other]);
  });
});

describe('applyQuery sorting', () => {
  it('puts an unscored application below a genuinely bad one, not among them', () => {
    const unscored = record({ matchScore: null, company: 'A' });
    const bad = record({ matchScore: 12, company: 'B' });
    const result = applyQuery([unscored, bad], { ...EMPTY_QUERY, sort: 'matchScore', direction: 'desc' });
    expect(result.map((r) => r.company)).toEqual(['B', 'A']);
  });

  it('sorts a date column soonest-first and leaves the undated at the end', () => {
    const soon = record({ nextActionAt: NOW + DAY, company: 'Soon' });
    const later = record({ nextActionAt: NOW + 5 * DAY, company: 'Later' });
    const never = record({ nextActionAt: null, company: 'Never' });
    const result = applyQuery([never, later, soon], { ...EMPTY_QUERY, sort: 'nextActionAt', direction: 'asc' });
    expect(result.map((r) => r.company)).toEqual(['Soon', 'Later', 'Never']);
  });

  it('breaks a tie the same way every time, so a list never reshuffles on its own', () => {
    const older = record({ priority: 'high', appliedAt: NOW - DAY, company: 'Older' });
    const newer = record({ priority: 'high', appliedAt: NOW, company: 'Newer' });
    const once = applyQuery([older, newer], { ...EMPTY_QUERY, sort: 'priority' });
    const twice = applyQuery([newer, older], { ...EMPTY_QUERY, sort: 'priority' });
    expect(once.map((r) => r.company)).toEqual(['Newer', 'Older']);
    expect(twice.map((r) => r.company)).toEqual(once.map((r) => r.company));
  });

  it('does not mutate what it was given', () => {
    const records = [record({ company: 'B' }), record({ company: 'A' })];
    const before = records.map((r) => r.company);
    applyQuery(records, { ...EMPTY_QUERY, sort: 'company', direction: 'asc' });
    expect(records.map((r) => r.company)).toEqual(before);
  });
});

describe('defaultDirectionFor', () => {
  it('starts a name A-Z and a count highest-first, which is what each one means', () => {
    expect(defaultDirectionFor('company')).toBe('asc');
    expect(defaultDirectionFor('nextActionAt')).toBe('asc');
    expect(defaultDirectionFor('matchScore')).toBe('desc');
    expect(defaultDirectionFor('appliedAt')).toBe('desc');
  });
});

describe('groupByStatus', () => {
  it('returns every column in pipeline order, including the empty ones', () => {
    const columns = groupByStatus([record({ status: 'offer' })]);
    expect(columns.map((c) => c.status)).toEqual(['applied', 'replied', 'interview', 'offer', 'rejected']);
    expect(columns.find((c) => c.status === 'offer')!.records).toHaveLength(1);
    expect(columns.find((c) => c.status === 'applied')!.records).toEqual([]);
  });
});

describe('allTags', () => {
  it('leads with the tags in heaviest use', () => {
    const records = [
      record({ tags: ['Berlin', 'Remote'] }),
      record({ tags: ['Berlin'] }),
      record({ tags: ['Berlin', 'Remote'] }),
      record({ tags: ['Onsite'] }),
    ];
    expect(allTags(records)).toEqual(['Berlin', 'Remote', 'Onsite']);
  });
});

describe('summarize', () => {
  it('counts a reply as anything past applied, however it went', () => {
    const records = [
      record({ status: 'applied' }),
      record({ status: 'rejected' }),
      record({ status: 'interview' }),
      record({ status: 'offer' }),
    ];
    const stats = summarize(records, NOW);
    expect(stats.replied).toBe(3);
    expect(stats.replyRate).toBe(75);
    expect(stats.interviewing).toBe(1);
  });

  it('has no reply rate at all before anything is sent, rather than 0%', () => {
    expect(summarize([], NOW).replyRate).toBeNull();
    expect(summarize([], NOW).averageScore).toBeNull();
  });

  it('averages only the applications that were scored', () => {
    const records = [record({ matchScore: 80 }), record({ matchScore: 60 }), record({ matchScore: null })];
    expect(summarize(records, NOW).averageScore).toBe(70);
  });

  it('does not call a closed application overdue', () => {
    const past = NOW - DAY;
    const records = [
      record({ nextActionAt: past, status: 'applied' }),
      record({ nextActionAt: past, status: 'rejected' }),
      record({ nextActionAt: past, status: 'offer' }),
      record({ nextActionAt: NOW + DAY, status: 'applied' }),
    ];
    expect(summarize(records, NOW).overdue).toBe(1);
  });

  it('counts the last 30 days against the clock it was given', () => {
    const records = [record({ appliedAt: NOW - 10 * DAY }), record({ appliedAt: NOW - 40 * DAY })];
    expect(summarize(records, NOW).last30Days).toBe(1);
  });
});

describe('weeklyVolume', () => {
  it('puts this week last and counts each application into its own week', () => {
    const records = [
      record({ appliedAt: NOW }),
      record({ appliedAt: NOW - DAY }),
      record({ appliedAt: NOW - 8 * DAY }),
    ];
    const weeks = weeklyVolume(records, 4, NOW);
    expect(weeks).toHaveLength(4);
    expect(weeks[3]).toBe(2);
    expect(weeks[2]).toBe(1);
  });

  it('ignores anything older than the window rather than piling it into week one', () => {
    expect(weeklyVolume([record({ appliedAt: NOW - 400 * DAY })], 4, NOW)).toEqual([0, 0, 0, 0]);
  });
});

describe('date inputs', () => {
  it('round-trips a date without the timezone moving it a day', () => {
    // The bug this guards: `toISOString().slice(0, 10)` reads local midnight as
    // the previous day for anyone west of Greenwich, and `new Date('2026-03-01')`
    // parses a bare date as UTC and does it again on the way back.
    const at = new Date(2026, 2, 1).getTime();
    expect(toDateInput(at)).toBe('2026-03-01');
    expect(fromDateInput('2026-03-01')).toBe(at);
  });

  it('treats no date and an empty field as the same thing', () => {
    expect(toDateInput(null)).toBe('');
    expect(fromDateInput('')).toBeNull();
    expect(fromDateInput('not a date')).toBeNull();
  });
});
