import { describe, expect, it } from 'vitest';
import { byGroup, shortName, statusFor, tally, writable, type PlannedField } from './field-plan';

const field = (over: Partial<PlannedField>): PlannedField => ({
  id: 'f1',
  label: 'Email',
  name: 'email',
  path: 'contact.email',
  current: '',
  proposed: '',
  status: 'you',
  group: 'Contact',
  ...over,
});

describe('statusFor', () => {
  it('is done when the field already holds what we would write', () => {
    // Re-running on a part-filled form should say what is already correct
    // rather than proposing to write it again.
    expect(statusFor({ current: 'a@b.com', proposed: 'a@b.com', path: 'contact.email' })).toBe('done');
  });

  it('ignores surrounding whitespace when comparing', () => {
    expect(statusFor({ current: ' a@b.com ', proposed: 'a@b.com', path: 'contact.email' })).toBe('done');
  });

  it('is ready when we have a value and the field differs', () => {
    expect(statusFor({ current: 'old@x.com', proposed: 'a@b.com', path: 'contact.email' })).toBe('ready');
  });

  it('is ready for an empty field we can fill', () => {
    expect(statusFor({ current: '', proposed: 'a@b.com', path: 'contact.email' })).toBe('ready');
  });

  it('sends an open question with no stored answer to drafting', () => {
    expect(statusFor({ current: '', proposed: '', path: null, isQuestion: true })).toBe('ai');
  });

  it('asks the user for a short factual field we have nothing for', () => {
    // Asking a model to invent a start date is how a wrong answer gets
    // submitted under the user's name.
    expect(statusFor({ current: '', proposed: '', path: 'logistics.availableFrom' })).toBe('you');
  });

  it('skips an untouched optional field', () => {
    expect(statusFor({ current: '', proposed: '', path: null, optional: true })).toBe('skip');
  });

  it('still asks about an optional field the user already started', () => {
    expect(statusFor({ current: 'half typed', proposed: '', path: null, optional: true })).toBe('you');
  });
});

describe('tally', () => {
  it('counts done and ready together, because both are handled', () => {
    const counts = tally([
      field({ status: 'done' }),
      field({ status: 'ready' }),
      field({ status: 'you' }),
      field({ status: 'ai' }),
      field({ status: 'skip' }),
    ]);
    expect(counts).toEqual({ total: 5, ready: 2, you: 1, ai: 1 });
  });

  it('handles a form with nothing in it', () => {
    expect(tally([])).toEqual({ total: 0, ready: 0, you: 0, ai: 0 });
  });
});

describe('writable', () => {
  it('offers only the fields that would actually change', () => {
    const fields = [
      field({ id: 'a', status: 'ready' }),
      field({ id: 'b', status: 'done' }),
      field({ id: 'c', status: 'you' }),
      field({ id: 'd', status: 'ai' }),
    ];
    expect(writable(fields).map((f) => f.id)).toEqual(['a']);
  });
});

describe('byGroup', () => {
  it('keeps the form’s own order rather than imposing an alphabet', () => {
    // Reading the panel top to bottom should be reading the form top to bottom.
    const fields = [
      field({ id: '1', group: 'Contact' }),
      field({ id: '2', group: 'Questions' }),
      field({ id: '3', group: 'Contact' }),
    ];
    expect(byGroup(fields).map(([name, items]) => [name, items.length])).toEqual([
      ['Contact', 2],
      ['Questions', 1],
    ]);
  });
});

describe('shortName', () => {
  it('uses the last segment of a matched path', () => {
    expect(shortName('Email address', 'contact.email')).toBe('email');
  });

  it('condenses an unmatched label to something that survives clipping', () => {
    expect(shortName('What is your earliest possible start date?', null)).toBe('what_is');
  });

  it('never returns an empty name', () => {
    expect(shortName('???', null)).toBe('field');
  });
});
