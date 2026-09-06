import { describe, expect, it } from 'vitest';
import { assessReadiness, type ReadinessInput } from './readiness';
import { atsFromUrl } from './company-scraper';
import { groupForRequiredSection, groupForStep, SETUP_GROUPS } from './setup-groups';
import { EMPTY_PROFILE, type Profile } from './schema';

const complete: Profile = {
  ...EMPTY_PROFILE,
  contact: {
    ...EMPTY_PROFILE.contact,
    firstName: 'Jordan',
    lastName: 'Avery',
    email: 'a@example.com',
    phone: '+49 170',
    city: 'Berlin',
    country: 'Germany',
  },
  workAuthorization: { ...EMPTY_PROFILE.workAuthorization, authorizedToWorkInCountry: true },
};

const base: ReadinessInput = {
  profile: complete,
  uncoveredSources: 0,
  totalSources: 6,
  hasBank: true,
  documentsFolderLinked: true,
  aiConfigured: true,
};

describe('assessReadiness', () => {
  it('is ready when nothing is missing', () => {
    const result = assessReadiness(base);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.summary).toContain('7 of 7 required fields');
    expect(result.summary).toContain('bank covers 6 of 6');
  });

  it('names the missing field, not just that something is missing', () => {
    const noPhone = { ...complete, contact: { ...complete.contact, phone: '' } };
    const [blocker] = assessReadiness({ ...base, profile: noPhone }).blockers;
    expect(blocker!.label).toBe('Phone is empty');
    expect(blocker!.action).toBe('Add it');
  });

  it('points a missing field at the group that actually holds it', () => {
    // The whole reason this exists: every "Complete profile" link used to open
    // Contact, whatever was wrong.
    const noAuth = {
      ...complete,
      workAuthorization: { ...complete.workAuthorization, authorizedToWorkInCountry: null },
    };
    const [blocker] = assessReadiness({ ...base, profile: noAuth }).blockers;
    expect(blocker!.target).toBe('answers');
    expect(blocker!.step).toBe('work-auth');
  });

  it('blocks on an unlinked documents folder', () => {
    const result = assessReadiness({ ...base, documentsFolderLinked: false });
    expect(result.ready).toBe(false);
    expect(result.blockers.map((b) => b.id)).toContain('documents');
  });

  it('reports a bank gap without blocking on it', () => {
    // The resume falls back to the user's own wording, so this is a warning.
    const result = assessReadiness({ ...base, uncoveredSources: 2 });
    expect(result.ready).toBe(true);
    expect(result.blockers.map((b) => b.id)).toContain('bank');
  });

  it('says nothing about a bank that was never generated', () => {
    const result = assessReadiness({ ...base, hasBank: false, uncoveredSources: 6 });
    expect(result.blockers.map((b) => b.id)).not.toContain('bank');
    expect(result.summary).toContain('no tailoring bank yet');
  });

  it('does not mention a bank when there is no AI backend to build one', () => {
    const result = assessReadiness({ ...base, hasBank: false, aiConfigured: false });
    expect(result.summary).not.toContain('bank');
  });

  it('lists every missing required field, not just the first', () => {
    const bare = assessReadiness({ ...base, profile: EMPTY_PROFILE });
    expect(bare.blockers.length).toBeGreaterThanOrEqual(7);
    expect(bare.ready).toBe(false);
  });
});

describe('setup groups', () => {
  it('covers every group with a unique id', () => {
    expect(new Set(SETUP_GROUPS.map((g) => g.id)).size).toBe(SETUP_GROUPS.length);
  });

  it('never puts one step in two groups', () => {
    const steps = SETUP_GROUPS.flatMap((g) => g.steps);
    expect(new Set(steps).size).toBe(steps.length);
  });

  it('finds the group a step belongs to', () => {
    expect(groupForStep('bank')).toBe('documents');
    expect(groupForStep('contact')).toBe('profile');
    expect(groupForStep('nonsense')).toBeNull();
  });

  it('routes work authorisation away from the profile group', () => {
    expect(groupForRequiredSection('workAuthorization')).toBe('answers');
    expect(groupForRequiredSection('contact')).toBe('profile');
  });
});

describe('atsFromUrl', () => {
  it('names the tracking system the form belongs to', () => {
    expect(atsFromUrl('https://jobs.ashbyhq.com/enpal/x')).toBe('Ashby');
    expect(atsFromUrl('https://boards.greenhouse.io/gitlab/jobs/1')).toBe('Greenhouse');
    expect(atsFromUrl('https://enpal.jobs.personio.de/job/1')).toBe('Personio');
    expect(atsFromUrl('https://acme.myworkdayjobs.com/en-US/x')).toBe('Workday');
  });

  it('is null on a company’s own careers page', () => {
    expect(atsFromUrl('https://careers.enpal.de/jobs/1')).toBeNull();
  });

  it('does not match a lookalike hostname', () => {
    expect(atsFromUrl('https://notgreenhouse.io/jobs')).toBeNull();
  });
});
