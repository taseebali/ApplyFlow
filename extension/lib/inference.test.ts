import { describe, expect, it } from 'vitest';
import { inferAnswer } from './inference';
import { EMPTY_PROFILE, type Profile } from './schema';

function profileWith(overrides: Partial<Profile>): Profile {
  return { ...EMPTY_PROFILE, ...overrides };
}

const studyingInBerlin = profileWith({
  contact: { ...EMPTY_PROFILE.contact, city: 'Berlin' },
  education: [
    {
      id: 'e1',
      school: 'Hochschule Berlin',
      degree: 'B.Sc. Computer Science',
      fieldOfStudy: '',
      startDate: '2024',
      endDate: '2027',
      current: true,
    },
  ],
});

describe('currently-enrolled', () => {
  it('answers yes while a course is in progress', () => {
    expect(inferAnswer('Are you currently enrolled at a German university/college?', studyingInBerlin)).toBe('Yes');
  });

  it('answers no once every course is finished', () => {
    const graduated = profileWith({
      education: [{ ...studyingInBerlin.education[0]!, current: false }],
    });
    expect(inferAnswer('Are you currently enrolled at a university?', graduated)).toBe('No');
  });

  it('says nothing when there is no education on file', () => {
    expect(inferAnswer('Are you currently enrolled at a university?', EMPTY_PROFILE)).toBeNull();
  });
});

describe('based-in-city', () => {
  it('answers yes when the question names the city they live in', () => {
    expect(inferAnswer('Are you currently based in Berlin?', studyingInBerlin)).toBe('Yes');
  });

  it('answers no when it names a different city', () => {
    expect(inferAnswer('Are you currently based in Munich?', studyingInBerlin)).toBe('No');
  });

  it('says nothing when no city is saved', () => {
    expect(inferAnswer('Are you currently based in Berlin?', EMPTY_PROFILE)).toBeNull();
  });
});

describe('hybrid-office-days', () => {
  it('answers yes when they already live in that city', () => {
    const question =
      'Our team works in a hybrid model. Are you able to work from our Berlin office at least 2 days per week?';
    expect(inferAnswer(question, studyingInBerlin)).toBe('Yes');
  });

  it('answers yes when they are willing to relocate', () => {
    const willing = profileWith({
      logistics: { ...EMPTY_PROFILE.logistics, willingToRelocate: true },
    });
    expect(inferAnswer('Can you work from our Hamburg office 2 days per week?', willing)).toBe('Yes');
  });

  it('says nothing when it cannot tell', () => {
    expect(inferAnswer('Can you work from our Hamburg office 2 days per week?', studyingInBerlin)).toBeNull();
  });
});

describe('needs-to-relocate', () => {
  it('answers no when they already live there, rather than reusing the yes', () => {
    expect(inferAnswer('Would you need to relocate to Berlin?', studyingInBerlin)).toBe('No');
  });

  it('uses the saved preference for somewhere else', () => {
    const unwilling = profileWith({
      logistics: { ...EMPTY_PROFILE.logistics, willingToRelocate: false },
    });
    expect(inferAnswer('Are you willing to relocate to Munich?', unwilling)).toBe('No');
  });
});

describe('availability', () => {
  it('answers with the saved start date', () => {
    const available = profileWith({
      logistics: { ...EMPTY_PROFILE.logistics, availableFrom: 'Immediately' },
    });
    expect(inferAnswer('When could you start at Raisin?', available)).toBe('Immediately');
  });
});

describe('inferAnswer', () => {
  it('leaves unrelated questions alone rather than guessing', () => {
    expect(inferAnswer('Why do you want to work here?', studyingInBerlin)).toBeNull();
    expect(inferAnswer('What is your expected salary?', studyingInBerlin)).toBeNull();
    expect(inferAnswer('', studyingInBerlin)).toBeNull();
  });
});
