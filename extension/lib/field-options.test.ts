import { beforeEach, describe, expect, it } from 'vitest';
import { matchOption, optionsFor } from './field-options';

const render = (html: string) => {
  document.body.innerHTML = html;
  return document.body;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('optionsFor', () => {
  it('reads a native select, without its placeholder row', () => {
    render(`
      <select id="loc">
        <option value="">Select a location</option>
        <option value="b">Berlin</option>
        <option value="m">Munich</option>
      </select>
    `);
    expect(optionsFor(document.getElementById('loc')!)).toEqual(['Berlin', 'Munich']);
  });

  it('reads a radio group as its option labels, not its question', () => {
    render(`
      <fieldset>
        <legend>Are you authorised to work in Germany?</legend>
        <label><input type="radio" name="auth" value="y"> Yes</label>
        <label><input type="radio" name="auth" value="n"> No</label>
      </fieldset>
    `);
    const first = document.querySelector<HTMLInputElement>('input[name="auth"]')!;
    expect(optionsFor(first)).toEqual(['Yes', 'No']);
  });

  it('reads a combobox through aria-controls', () => {
    // The location field on the posting that started this: role="combobox",
    // no native select, so there was nothing to read a value from — while the
    // page was displaying the exact list it would accept.
    render(`
      <input role="combobox" id="city" aria-controls="cities">
      <ul id="cities" role="listbox">
        <li role="option">Berlin</li>
        <li role="option">Hamburg</li>
      </ul>
    `);
    expect(optionsFor(document.getElementById('city')!)).toEqual(['Berlin', 'Hamburg']);
  });

  it('finds a listbox a combobox never declared a relationship to', () => {
    render(`
      <div class="field">
        <input role="combobox" id="city">
        <ul role="listbox"><li role="option">Berlin</li></ul>
      </div>
    `);
    expect(optionsFor(document.getElementById('city')!)).toEqual(['Berlin']);
  });

  it('reads a datalist behind a plain text input', () => {
    render(`
      <input id="src" list="sources">
      <datalist id="sources"><option value="LinkedIn"></option><option value="Referral"></option></datalist>
    `);
    expect(optionsFor(document.getElementById('src')!)).toEqual(['LinkedIn', 'Referral']);
  });

  it('says nothing for a free-text field', () => {
    render('<input id="name" type="text">');
    expect(optionsFor(document.getElementById('name')!)).toEqual([]);
  });

  it('declines to show a country list', () => {
    // Two hundred options is not a choice the panel can usefully display, and
    // showing the first forty would be worse than showing none.
    const options = Array.from({ length: 200 }, (_, i) => `<option value="${i}">Country ${i}</option>`).join('');
    render(`<select id="country">${options}</select>`);
    expect(optionsFor(document.getElementById('country')!)).toEqual([]);
  });
});

describe('matchOption', () => {
  it('takes an exact answer', () => {
    expect(matchOption(['Berlin', 'Munich'], 'Berlin')).toBe('Berlin');
  });

  it('ignores case, so "yes" fills a "Yes"', () => {
    expect(matchOption(['Yes', 'No'], 'yes')).toBe('Yes');
  });

  it('accepts a longer option that contains the answer', () => {
    expect(matchOption(['Berlin, Germany', 'Munich, Germany'], 'Berlin')).toBe('Berlin, Germany');
  });

  it('refuses to choose when two options would fit', () => {
    // "Berlin" against both "Berlin" and "Berlin (remote)" is the user's call.
    expect(matchOption(['Berlin (remote)', 'Berlin (onsite)'], 'Berlin')).toBeNull();
  });

  it('says nothing when there is nothing to match', () => {
    expect(matchOption([], 'Berlin')).toBeNull();
    expect(matchOption(['Berlin'], '')).toBeNull();
  });
});
