import type { Profile } from './schema';

/**
 * The fields a fill is useless without. Almost every application form asks for
 * all of them, so an empty one means the fill will leave a required box blank
 * and the user finds out only at submit time.
 *
 * Anything else — links, projects, languages, EEO answers — makes a fill
 * better but not necessary, so it deliberately stays off this list.
 */
export interface RequiredField {
  /** Where the field lives, so the UI can point at the right setup tab. */
  section: 'contact' | 'workAuthorization';
  key: string;
  label: string;
  isSet: (profile: Profile) => boolean;
}

const notBlank = (value: string) => value.trim().length > 0;

export const REQUIRED_FIELDS: RequiredField[] = [
  { section: 'contact', key: 'firstName', label: 'First name', isSet: (p) => notBlank(p.contact.firstName) },
  { section: 'contact', key: 'lastName', label: 'Last name', isSet: (p) => notBlank(p.contact.lastName) },
  { section: 'contact', key: 'email', label: 'Email', isSet: (p) => notBlank(p.contact.email) },
  { section: 'contact', key: 'phone', label: 'Phone', isSet: (p) => notBlank(p.contact.phone) },
  { section: 'contact', key: 'city', label: 'City', isSet: (p) => notBlank(p.contact.city) },
  { section: 'contact', key: 'country', label: 'Country', isSet: (p) => notBlank(p.contact.country) },
  {
    section: 'workAuthorization',
    key: 'authorizedToWorkInCountry',
    label: 'Work authorization',
    // A boolean field is answered when it is either true or false; only the
    // untouched `null` counts as missing.
    isSet: (p) => p.workAuthorization.authorizedToWorkInCountry !== null,
  },
];

export function isRequired(section: string, key: string): boolean {
  return REQUIRED_FIELDS.some((field) => field.section === section && field.key === key);
}

export function missingRequiredFields(profile: Profile): RequiredField[] {
  return REQUIRED_FIELDS.filter((field) => !field.isSet(profile));
}

/** 0–1, for a progress indicator in setup. */
export function completeness(profile: Profile): number {
  const missing = missingRequiredFields(profile).length;
  return (REQUIRED_FIELDS.length - missing) / REQUIRED_FIELDS.length;
}
