export interface WorkHistoryEntry {
  id: string;
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
}

export interface EducationEntry {
  id: string;
  school: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string;
  /**
   * When `current` is set this is the *expected* finish date, which is exactly
   * what application forms mean by "expected graduation date".
   */
  endDate: string;
  current: boolean;
}

export interface CustomQAEntry {
  id: string;
  question: string;
  answer: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  role: string;
  description: string;
  techStack: string;
  outcomes: string;
}

export interface Profile {
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  links: {
    linkedin: string;
    github: string;
    portfolio: string;
    website: string;
  };
  workHistory: WorkHistoryEntry[];
  education: EducationEntry[];
  projects: ProjectEntry[];
  workAuthorization: {
    authorizedToWorkInCountry: boolean | null;
    requiresSponsorship: boolean | null;
    veteranStatus: string;
    disabilityStatus: string;
    race: string;
    gender: string;
  };
  logistics: {
    availableFrom: string;
    willingToRelocate: boolean | null;
    /** Ordered by preference; the first one present among a form's options is used. */
    hearAboutUsPreferences: string[];
  };
  customQA: CustomQAEntry[];
}

export const EMPTY_PROFILE: Profile = {
  contact: {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  },
  links: {
    linkedin: '',
    github: '',
    portfolio: '',
    website: '',
  },
  workHistory: [],
  education: [],
  projects: [],
  workAuthorization: {
    authorizedToWorkInCountry: null,
    requiresSponsorship: null,
    veteranStatus: '',
    disabilityStatus: '',
    race: '',
    gender: '',
  },
  logistics: {
    availableFrom: '',
    willingToRelocate: null,
    hearAboutUsPreferences: ['LinkedIn', 'Social Media'],
  },
  customQA: [],
};

export function isProfile(value: unknown): value is Profile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.contact === 'object' &&
    typeof v.links === 'object' &&
    Array.isArray(v.workHistory) &&
    Array.isArray(v.education) &&
    Array.isArray(v.projects) &&
    typeof v.workAuthorization === 'object' &&
    typeof v.logistics === 'object' &&
    Array.isArray(v.customQA)
  );
}

/** A single flat schema field the field-matcher can target, with its alias phrases. */
export interface SchemaFieldDef {
  /** Dot path into a flattened Profile, e.g. "contact.firstName" */
  path: string;
  aliases: string[];
  /**
   * How to resolve and match a value for this field:
   * - "text": plain string, matched/set as-is (default).
   * - "boolean": a yes/no answer, matched against yes/no-ish options.
   * - "preference": an ordered list of acceptable answers; the first one
   *   present among the form's options/radio labels is used.
   */
  valueKind?: 'text' | 'boolean' | 'preference';
}

export const SCHEMA_FIELDS: SchemaFieldDef[] = [
  { path: 'contact.fullName', aliases: ['full name', 'name', 'complete name', 'your name', 'applicant name'] },
  {
    path: 'contact.firstName',
    aliases: ['first name', 'given name', 'legal first name', 'fname', 'vorname'],
  },
  {
    path: 'contact.lastName',
    aliases: ['last name', 'surname', 'family name', 'legal last name', 'lname', 'nachname'],
  },
  { path: 'contact.email', aliases: ['email', 'email address', 'e-mail'] },
  { path: 'contact.phone', aliases: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone'] },
  { path: 'contact.addressLine1', aliases: ['address', 'address line 1', 'street address', 'address 1'] },
  { path: 'contact.addressLine2', aliases: ['address line 2', 'apt', 'apartment', 'suite', 'address 2'] },
  { path: 'contact.city', aliases: ['city', 'town'] },
  { path: 'contact.state', aliases: ['state', 'province', 'region'] },
  { path: 'contact.postalCode', aliases: ['zip', 'zip code', 'postal code', 'postcode'] },
  { path: 'contact.country', aliases: ['country'] },
  {
    path: 'education.graduationDate',
    aliases: [
      'expected graduation date',
      'graduation date',
      'expected graduation',
      'expected completion date',
      'when do you graduate',
      'graduation',
    ],
  },
  { path: 'education.school', aliases: ['university', 'college', 'school', 'institution'] },
  { path: 'education.degree', aliases: ['degree', 'qualification'] },
  { path: 'education.fieldOfStudy', aliases: ['field of study', 'major', 'course of study', 'subject'] },
  { path: 'links.linkedin', aliases: ['linkedin', 'linkedin url', 'linkedin profile'] },
  { path: 'links.github', aliases: ['github', 'github url', 'github profile'] },
  { path: 'links.portfolio', aliases: ['portfolio', 'portfolio url', 'portfolio link'] },
  { path: 'links.website', aliases: ['website', 'personal website', 'personal site'] },
  {
    path: 'workAuthorization.authorizedToWorkInCountry',
    aliases: [
      'legal authorization to work',
      'legally authorized to work',
      'authorized to work',
      'eligible to work',
      'work authorization',
      'right to work',
    ],
    valueKind: 'boolean',
  },
  {
    path: 'workAuthorization.requiresSponsorship',
    aliases: ['require sponsorship', 'need sponsorship', 'require visa sponsorship', 'need visa sponsorship'],
    valueKind: 'boolean',
  },
  {
    path: 'workAuthorization.veteranStatus',
    aliases: ['veteran status', 'protected veteran', 'are you a veteran'],
  },
  {
    path: 'workAuthorization.disabilityStatus',
    aliases: ['disability status', 'do you have a disability'],
  },
  { path: 'workAuthorization.race', aliases: ['race', 'race ethnicity', 'ethnicity'] },
  { path: 'workAuthorization.gender', aliases: ['gender', 'gender identity', 'sex'] },
  {
    path: 'logistics.availableFrom',
    aliases: ['available from', 'availability', 'start date', 'earliest start date', 'when can you start', 'notice period'],
  },
  {
    path: 'logistics.willingToRelocate',
    aliases: ['willing to relocate', 'open to relocation', 'able to relocate', 'relocation'],
    valueKind: 'boolean',
  },
  {
    path: 'logistics.hearAboutUs',
    aliases: ['how did you hear about us', 'how did you hear about this job', 'how did you find us', 'referral source', 'source'],
    valueKind: 'preference',
  },
];
