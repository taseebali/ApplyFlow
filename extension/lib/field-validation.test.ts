import { describe, expect, it } from 'vitest';
import { adaptToField, fitToMaxLength, toIsoDate, validateWritten } from './field-validation';

function input(attrs: Record<string, string>): HTMLInputElement {
  const el = document.createElement('input');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  return el;
}

describe('toIsoDate', () => {
  it('passes an ISO date through', () => {
    expect(toIsoDate('2027-08-31')).toBe('2027-08-31');
  });

  it('reads a day-first date, which a German form will give', () => {
    expect(toIsoDate('31.08.2027')).toBe('2027-08-31');
    expect(toIsoDate('1/9/2027')).toBe('2027-09-01');
  });

  it('gives up on something with no date in it', () => {
    expect(toIsoDate('as soon as possible')).toBeNull();
  });
});

describe('adaptToField', () => {
  it('converts a date for a date input, which only accepts yyyy-mm-dd', () => {
    expect(adaptToField('31.08.2027', input({ type: 'date' }))).toBe('2027-08-31');
  });

  it('leaves an unparseable date alone rather than inventing one', () => {
    expect(adaptToField('immediately', input({ type: 'date' }))).toBe('immediately');
  });

  it('strips spacing from a phone number when the form demands it', () => {
    const el = input({ type: 'tel', pattern: '[+]?[0-9]+' });
    expect(adaptToField('+49 30 1234 5678', el)).toBe('+493012345678');
  });

  it('does not throw when the page declares a malformed pattern', () => {
    // A broken pattern attribute used to throw out of the whole fill.
    const el = input({ type: 'tel', pattern: '+?[0-9]+' });
    expect(adaptToField('+49 176', el)).toBe('+49 176');
  });

  it('leaves a phone number alone when the form already accepts it', () => {
    const el = input({ type: 'tel', pattern: '.*' });
    expect(adaptToField('+49 30 1234 5678', el)).toBe('+49 30 1234 5678');
  });

  it('trims to the declared maximum instead of being silently cut', () => {
    expect(fitToMaxLength('abcdefghij', input({ maxlength: '4' }))).toBe('abcd');
  });
});

describe('validateWritten', () => {
  it('says nothing when the field is happy', () => {
    const el = input({ type: 'email' });
    el.value = 'a@example.com';
    expect(validateWritten(el, 'Email')).toBeNull();
  });

  it('reports a value the form will reject at submit', () => {
    const el = input({ type: 'email' });
    el.value = 'not-an-email';
    const problem = validateWritten(el, 'Email');
    expect(problem?.label).toBe('Email');
    expect(problem?.reason).toMatch(/email/);
  });

  it('names a pattern mismatch as a format problem', () => {
    const el = input({ type: 'text', pattern: '[0-9]{5}' });
    el.value = 'abc';
    expect(validateWritten(el, 'Postal code')?.reason).toMatch(/format/);
  });
});
