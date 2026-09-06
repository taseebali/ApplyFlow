import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { planForm } from './plan-form';
import { byGroup, tally } from './field-plan';
import { EMPTY_PROFILE, type Profile } from './schema';

/**
 * The plan is checked against the same captured ATS forms the fill engine is
 * scored on. A plan that disagrees with what the fill would do is worse than no
 * plan, so this reads the real DOMs rather than a hand-built fixture.
 */

const DIR = join(__dirname, '..', 'fixtures', 'forms');

const profile: Profile = {
  ...EMPTY_PROFILE,
  contact: {
    ...EMPTY_PROFILE.contact,
    firstName: 'Jordan',
    lastName: 'Avery',
    email: 'alijordan@example.com',
    phone: '+49 30 1234 5678',
    city: 'Berlin',
    country: 'Germany',
  },
  workAuthorization: { ...EMPTY_PROFILE.workAuthorization, authorizedToWorkInCountry: true },
};

function load(name: string) {
  document.body.innerHTML = readFileSync(join(DIR, name), 'utf-8');
}

describe('planForm', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds fields on a real Greenhouse form', () => {
    load('greenhouse-gitlab.html');
    const plan = planForm(profile);
    expect(plan.fields.length).toBeGreaterThan(5);
  });

  it('proposes the profile’s value for a matched field', () => {
    load('greenhouse-gitlab.html');
    const plan = planForm(profile);
    const email = plan.fields.find((f) => f.path === 'contact.email');
    expect(email?.proposed).toBe('alijordan@example.com');
    expect(email?.status).toBe('ready');
  });

  it('proposes nothing when the profile is empty, and asks the user instead', () => {
    load('greenhouse-gitlab.html');
    const plan = planForm(EMPTY_PROFILE);
    expect(plan.fields.every((f) => f.proposed === '')).toBe(true);
    expect(plan.fields.some((f) => f.status === 'you')).toBe(true);
  });

  it('reports a field that already holds the right value as done, not ready', () => {
    load('greenhouse-gitlab.html');
    const first = planForm(profile).fields.find((f) => f.path === 'contact.email');
    const input = document.querySelector<HTMLInputElement>('input[type="email"], input#email');
    if (input) {
      input.value = 'alijordan@example.com';
      const after = planForm(profile).fields.find((f) => f.path === 'contact.email');
      expect(first?.status).toBe('ready');
      expect(after?.status).toBe('done');
    }
  });

  it('works on a German Personio form', () => {
    load('personio-de.html');
    const plan = planForm(profile);
    expect(plan.fields.length).toBeGreaterThan(3);
    expect(plan.fields.some((f) => f.path === 'contact.email')).toBe(true);
  });

  it('works on an Ashby form that has no form element at all', () => {
    load('enpal-de.html');
    expect(planForm(profile).fields.length).toBeGreaterThan(3);
  });

  it('gives every field a group and a short machine name', () => {
    load('greenhouse-gitlab.html');
    for (const field of planForm(profile).fields) {
      expect(field.group).not.toBe('');
      expect(field.name).not.toBe('');
      expect(field.name).not.toContain(' ');
    }
  });

  it('gives every field a unique id, so the list can be keyed and addressed', () => {
    load('greenhouse-gitlab.html');
    const ids = planForm(profile).fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('counts up to the number of fields it found', () => {
    load('greenhouse-gitlab.html');
    const plan = planForm(profile);
    const counts = tally(plan.fields);
    expect(counts.total).toBe(plan.fields.length);
    expect(counts.ready + counts.you + counts.ai).toBeLessThanOrEqual(counts.total);
  });

  it('keeps groups in the order the page presents them', () => {
    load('greenhouse-gitlab.html');
    const groups = byGroup(planForm(profile).fields);
    expect(groups.length).toBeGreaterThan(0);
    expect(new Set(groups.map(([name]) => name)).size).toBe(groups.length);
  });

  it('shows one row per profile path, with a count when several controls share it', () => {
    // Greenhouse matches three separate controls to contact.country. The fill
    // writes to all of them, so hiding two would misreport; repeating the row
    // three times is noise.
    load('greenhouse-gitlab.html');
    const country = planForm(profile).fields.filter((f) => f.path === 'contact.country');
    expect(country).toHaveLength(1);
    expect(country[0]!.count).toBeGreaterThan(1);
  });

  it('answers a yes/no question from the profile instead of asking the user', () => {
    // Every sponsorship and authorisation question reported as needing the user
    // until the plan resolved booleans, because the text resolver returns
    // nothing for them.
    load('greenhouse-gitlab.html');
    const answered: Profile = {
      ...profile,
      workAuthorization: { ...profile.workAuthorization, requiresSponsorship: false },
    };
    const field = planForm(answered).fields.find((f) => f.path === 'workAuthorization.requiresSponsorship');
    expect(field?.proposed).toBe('No');
    expect(field?.status).toBe('ready');
  });

  it('leaves an unanswered yes/no question with the user', () => {
    load('greenhouse-gitlab.html');
    const field = planForm(profile).fields.find((f) => f.path === 'workAuthorization.requiresSponsorship');
    expect(field?.status).toBe('you');
  });

  it('returns an empty plan for a page with no form rather than throwing', () => {
    document.body.innerHTML = '<main><p>Nothing to fill here.</p></main>';
    expect(planForm(profile).fields).toEqual([]);
  });
});
