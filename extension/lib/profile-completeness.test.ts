import { describe, expect, it } from 'vitest';
import { completeness, isRequired, missingRequiredFields, REQUIRED_FIELDS } from './profile-completeness';
import { EMPTY_PROFILE, type Profile } from './schema';

const filled: Profile = {
  ...EMPTY_PROFILE,
  contact: {
    ...EMPTY_PROFILE.contact,
    firstName: 'Jordan',
    lastName: 'Avery',
    email: 'a@example.com',
    phone: '+49 3000000000',
    city: 'Berlin',
    country: 'Germany',
  },
  workAuthorization: { ...EMPTY_PROFILE.workAuthorization, authorizedToWorkInCountry: true },
};

describe('missingRequiredFields', () => {
  it('lists everything on an empty profile', () => {
    expect(missingRequiredFields(EMPTY_PROFILE)).toHaveLength(REQUIRED_FIELDS.length);
  });

  it('is empty once the essentials are filled', () => {
    expect(missingRequiredFields(filled)).toEqual([]);
    expect(completeness(filled)).toBe(1);
  });

  it('treats whitespace as unfilled', () => {
    const blank = { ...filled, contact: { ...filled.contact, phone: '   ' } };
    expect(missingRequiredFields(blank).map((f) => f.key)).toEqual(['phone']);
  });

  it('counts a work authorization answer of "no" as answered', () => {
    const declined = {
      ...filled,
      workAuthorization: { ...filled.workAuthorization, authorizedToWorkInCountry: false },
    };
    expect(missingRequiredFields(declined)).toEqual([]);
  });
});

describe('isRequired', () => {
  it('knows which contact fields matter', () => {
    expect(isRequired('contact', 'email')).toBe(true);
    expect(isRequired('contact', 'addressLine2')).toBe(false);
  });
});
