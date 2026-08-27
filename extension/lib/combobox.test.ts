import { beforeEach, describe, expect, it } from 'vitest';
import { isCombobox } from './combobox';

function setBody(html: string) {
  document.body.innerHTML = html;
}

const first = () => document.querySelector('input')!;

describe('isCombobox', () => {
  beforeEach(() => setBody(''));

  it('recognises an explicit combobox role', () => {
    setBody('<input role="combobox" />');
    expect(isCombobox(first())).toBe(true);
  });

  it('recognises the ARIA listbox and autocomplete markers', () => {
    setBody('<input aria-haspopup="listbox" />');
    expect(isCombobox(first())).toBe(true);
    setBody('<input aria-autocomplete="list" />');
    expect(isCombobox(first())).toBe(true);
  });

  it("recognises Greenhouse's react-select markup by its container", () => {
    // Matches the real structure on job-boards.greenhouse.io.
    setBody(`
      <div class="select__container select__container--outside-label">
        <label id="country-label" for="country">Country</label>
        <div class="select__control remix-css-13cymwt-control">
          <input id="country" type="text" />
        </div>
      </div>
    `);
    expect(isCombobox(first())).toBe(true);
  });

  it('leaves ordinary text inputs alone', () => {
    setBody('<label for="e">Email</label><input id="e" type="text" />');
    expect(isCombobox(first())).toBe(false);
  });

  it('is false for non-input elements', () => {
    setBody('<select role="combobox"><option>a</option></select>');
    expect(isCombobox(document.querySelector('select')!)).toBe(false);
  });
});
