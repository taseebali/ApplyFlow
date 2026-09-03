/**
 * One achievement, on its own.
 *
 * Replaces the single description blob a role used to carry. Tailoring works by
 * choosing which achievements appear for a given posting and in what order, and
 * that is only possible if they are separate things rather than one paragraph.
 */
export interface BulletEntry {
  id: string;
  text: string;
}

/**
 * Splits a legacy description blob into bullets, on line breaks or bullet
 * characters. Written once as a migration, and reused by the resume importer.
 */
export function textToBullets(text: string): BulletEntry[] {
  return text
    .split(/\r?\n|(?:^|\s)[•·▪]\s*/)
    .map((line) => line.replace(/^[-*\s]+/, '').trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ id: crypto.randomUUID(), text: line }));
}

/** The blob form, for the places that still want one — an AI prompt, say. */
export function bulletsToText(bullets: BulletEntry[]): string {
  return bullets.map((b) => b.text).join('\n');
}

export interface WorkHistoryEntry {
  id: string;
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  bullets: BulletEntry[];
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

/** CEFR is what application forms ask for, so it is what we store. */
export const LANGUAGE_LEVELS = [
  'A1 (Basic)',
  'A2 (Basic)',
  'B1 (Intermediate)',
  'B2 (Intermediate)',
  'C1 (Advanced)',
  'C2 (Fluent)',
  'Native',
] as const;

export interface LanguageEntry {
  id: string;
  language: string;
  level: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  role: string;
  bullets: BulletEntry[];
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
  languages: LanguageEntry[];
  workAuthorization: {
    /** A yes/no answer, for forms that ask "are you authorised to work here?". */
    authorizedToWorkInCountry: boolean | null;
    /** The specific status, for forms that offer a list rather than yes/no. */
    status: string;
    requiresSponsorship: boolean | null;
    veteranStatus: string;
    disabilityStatus: string;
    race: string;
    gender: string;
  };
  logistics: {
    availableFrom: string;
    willingToRelocate: boolean | null;
    /**
     * What the candidate asks for, in their own words — "65000", "60-70k",
     * "negotiable". Deliberately free text and deliberately theirs: a salary
     * expectation is a negotiating position, not a fact to be looked up.
     */
    salaryExpectation: string;
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
  languages: [],
  workAuthorization: {
    authorizedToWorkInCountry: null,
    status: '',
    requiresSponsorship: null,
    veteranStatus: '',
    disabilityStatus: '',
    race: '',
    gender: '',
  },
  logistics: {
    availableFrom: '',
    willingToRelocate: null,
    salaryExpectation: '',
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
    Array.isArray(v.languages) &&
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
  { path: 'contact.fullName', aliases: ['full name', 'name', 'complete name', 'your name', 'applicant name', 'vollstandiger name', 'vor und nachname'] },
  {
    path: 'contact.firstName',
    aliases: ['first name', 'given name', 'legal first name', 'fname', 'vorname'],
  },
  {
    path: 'contact.lastName',
    aliases: ['last name', 'surname', 'family name', 'legal last name', 'lname', 'nachname', 'familienname'],
  },
  { path: 'contact.email', aliases: ['email', 'email address', 'e-mail', 'e mail adresse', 'e mail', 'mailadresse'] },
  { path: 'contact.phone', aliases: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'telefon', 'telefonnummer', 'handynummer', 'mobilnummer', 'rufnummer'] },
  { path: 'contact.addressLine1', aliases: ['address', 'address line 1', 'street address', 'address 1', 'adresse', 'anschrift', 'strasse', 'strasse und hausnummer', 'strasse hausnummer'] },
  { path: 'contact.addressLine2', aliases: ['address line 2', 'apt', 'apartment', 'suite', 'address 2', 'adresszusatz'] },
  { path: 'contact.city', aliases: ['city', 'town', 'stadt', 'ort', 'wohnort'] },
  { path: 'contact.state', aliases: ['state', 'province', 'region', 'bundesland'] },
  { path: 'contact.postalCode', aliases: ['zip', 'zip code', 'postal code', 'postcode', 'plz', 'postleitzahl'] },
  { path: 'contact.country', aliases: ['country', 'land'] },
  {
    path: 'education.graduationDate',
    aliases: [
      'expected graduation date',
      'graduation date',
      'expected graduation',
      'expected completion date',
      'when do you graduate',
      'graduation',
    'voraussichtlicher abschluss', 'abschlussdatum', 'studienende'],
  },
  { path: 'education.school', aliases: ['university', 'college', 'school', 'institution', 'universitat', 'hochschule', 'fachhochschule', 'schule', 'bildungseinrichtung'] },
  { path: 'education.degree', aliases: ['degree', 'qualification', 'abschluss', 'studienabschluss', 'hochster abschluss'] },
  {
    path: 'languages.list',
    aliases: ['which languages', 'languages you speak', 'languages', 'spoken languages', 'sprachen', 'sprachkenntnisse', 'welche sprachen'],
  },
  {
    path: 'languages.german',
    aliases: ['german level', 'current german level', 'level of german', 'deutsch', 'deutschkenntnisse', 'deutsch niveau', 'deutschniveau'],
  },
  { path: 'education.fieldOfStudy', aliases: ['field of study', 'major', 'course of study', 'subject', 'studienfach', 'studiengang', 'fachrichtung'] },
  { path: 'links.linkedin', aliases: ['linkedin', 'linkedin url', 'linkedin profile', 'linkedin profil'] },
  { path: 'links.github', aliases: ['github', 'github url', 'github profile', 'github profil'] },
  { path: 'links.portfolio', aliases: ['portfolio', 'portfolio url', 'portfolio link'] },
  { path: 'links.website', aliases: ['website', 'personal website', 'personal site', 'webseite', 'homepage', 'personliche webseite'] },
  {
    // Forms that offer a list ("EU citizen", "Requires sponsorship", …) rather
    // than yes/no. Listed before the boolean so the specific wording wins.
    path: 'workAuthorization.status',
    aliases: [
      'work authorisation',
      'work authorization status',
      'work authorisation status',
      'visa status',
      'immigration status',
      'residency status',
      'work permit',
    'aufenthaltstitel', 'aufenthaltsstatus', 'arbeitsgenehmigung'],
  },
  {
    path: 'workAuthorization.authorizedToWorkInCountry',
    aliases: [
      'legal authorization to work',
      'legally authorized to work',
      'authorized to work',
      'eligible to work',
      'work authorization',
      'right to work',
    'arbeitserlaubnis', 'arbeitserlaubnis in deutschland', 'durfen sie in deutschland arbeiten'],
    valueKind: 'boolean',
  },
  {
    path: 'workAuthorization.requiresSponsorship',
    aliases: ['require sponsorship', 'need sponsorship', 'require visa sponsorship', 'need visa sponsorship', 'visum erforderlich', 'benotigen sie ein visum', 'visasponsoring'],
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
  { path: 'workAuthorization.gender', aliases: ['gender', 'gender identity', 'sex', 'geschlecht'] },
  {
    // Required on German forms (Gehaltsvorstellung) and common elsewhere. Until
    // this existed the field was left blank on every Personio application.
    path: 'logistics.salaryExpectation',
    aliases: [
      'salary expectation',
      'salary expectations',
      'expected salary',
      'desired salary',
      'salary requirement',
      'salary requirements',
      'compensation expectation',
      'compensation expectations',
      'gehaltsvorstellung',
      'gehaltswunsch',
      'wunschgehalt',
      'gehaltsvorstellungen',
    ],
  },
  {
    path: 'logistics.availableFrom',
    aliases: ['available from', 'availability', 'start date', 'earliest start date', 'when can you start', 'notice period', 'verfugbar ab', 'verfugbarkeit', 'eintrittsdatum', 'fruhestes eintrittsdatum', 'fruhester eintrittstermin', 'starttermin', 'kundigungsfrist', 'wann konnen sie anfangen'],
  },
  {
    path: 'logistics.willingToRelocate',
    aliases: ['willing to relocate', 'open to relocation', 'able to relocate', 'relocation', 'umzugsbereit', 'umzugsbereitschaft', 'wurden sie umziehen'],
    valueKind: 'boolean',
  },
  {
    path: 'logistics.hearAboutUs',
    aliases: ['how did you hear about us', 'how did you hear about this job', 'how did you find us', 'referral source', 'source'],
    valueKind: 'preference',
  },
];
