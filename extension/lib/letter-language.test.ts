import { describe, expect, it } from 'vitest';
import { CONVENTIONS, detectLanguage } from './letter-language';
import { assembleCoverLetter } from './resume-document';
import { EMPTY_PROFILE, type Profile } from './schema';

const GERMAN_POSTING = `
Wir suchen eine erfahrene Softwareentwicklerin für unser Team in Berlin.
Du arbeitest mit modernen Technologien und bringst deine Erfahrung mit Python
und Docker ein. Deine Aufgaben umfassen die Entwicklung und den Betrieb unserer
Plattform sowie die Zusammenarbeit mit anderen Teams. Wir bieten dir eine
unbefristete Stelle und flexible Arbeitszeiten. Bewirb dich jetzt bei uns.
`;

const ENGLISH_POSTING = `
We are looking for an experienced software engineer to join our team in Berlin.
You will work with modern technologies and bring your experience with Python and
Docker. Your responsibilities include building and running our platform, and
working with other teams across the company. We offer a permanent role and
flexible hours. Apply to us today and tell us what you have built.
`;

describe('detectLanguage', () => {
  it('reads a German posting as German', () => {
    expect(detectLanguage(GERMAN_POSTING)).toBe('de');
  });

  it('reads an English posting as English', () => {
    expect(detectLanguage(ENGLISH_POSTING)).toBe('en');
  });

  it('is not fooled by English technology names in a German posting', () => {
    expect(detectLanguage(GERMAN_POSTING)).toBe('de');
  });

  it('defaults to English rather than guessing from a fragment', () => {
    // A German letter written from a misread signal is not recoverable by the
    // reader; an English one to a German company is ordinary.
    expect(detectLanguage('Software Engineer')).toBe('en');
    expect(detectLanguage('')).toBe('en');
  });
});

describe('assembleCoverLetter', () => {
  const profile: Profile = {
    ...EMPTY_PROFILE,
    contact: {
      ...EMPTY_PROFILE.contact,
      firstName: 'Jordan',
      lastName: 'Avery',
      email: 'a@example.com',
      phone: '+49 170',
      postalCode: '10115',
      city: 'Berlin',
      country: 'Germany',
    },
  };

  const base = {
    profile,
    company: 'Enpal',
    role: 'AI Engineer',
    body: 'First paragraph.\n\nSecond paragraph.',
    today: new Date('2026-09-06T12:00:00Z'),
  };

  it('gives an English letter every part a letter has', () => {
    // The shipped letter had none of these: no date, no recipient, no subject,
    // no salutation, no sign-off, and the company named nowhere.
    const letter = assembleCoverLetter({ ...base, language: 'en' });
    expect(letter.subject).toBe('Application for AI Engineer');
    expect(letter.salutation).toBe('Dear Hiring Team at Enpal,');
    expect(letter.closing).toBe('Sincerely,');
    expect(letter.signature).toBe('Jordan Avery');
    expect(letter.date).toBe('6 September 2026');
    expect(letter.recipientLines).toContain('Enpal');
  });

  it('follows German conventions for a German letter', () => {
    const letter = assembleCoverLetter({ ...base, language: 'de' });
    expect(letter.subject).toBe('Bewerbung als AI Engineer');
    expect(letter.salutation).toBe('Sehr geehrte Damen und Herren,');
    expect(letter.closing).toBe('Mit freundlichen Grüßen');
    expect(letter.date).toBe('06.09.2026');
    expect(letter.dateOnRight).toBe(true);
  });

  it('splits the body into paragraphs and keeps them in order', () => {
    const letter = assembleCoverLetter({ ...base, language: 'en' });
    expect(letter.paragraphs).toEqual(['First paragraph.', 'Second paragraph.']);
  });

  it('builds the sender block from the profile, skipping what is blank', () => {
    const letter = assembleCoverLetter({ ...base, language: 'en' });
    expect(letter.senderLines[0]).toBe('Jordan Avery');
    expect(letter.senderLines).toContain('10115 Berlin');
    expect(letter.senderLines).not.toContain('');
  });

  it('stays a valid letter when the company is unknown', () => {
    const letter = assembleCoverLetter({ ...base, company: '', language: 'en' });
    expect(letter.salutation).toBe('Dear Hiring Team,');
    expect(letter.recipientLines).toEqual(['Hiring Team']);
  });

  it('never invents an address for the employer', () => {
    // A made-up street on a cover letter is worse than no address block.
    const letter = assembleCoverLetter({ ...base, language: 'de' });
    expect(letter.recipientLines).toEqual(['Enpal', 'Hiring Team']);
  });
});

describe('CONVENTIONS', () => {
  it('falls back to a bare subject when the role is unknown', () => {
    expect(CONVENTIONS.en.subject('')).toBe('Application');
    expect(CONVENTIONS.de.subject('')).toBe('Bewerbung');
  });
});
