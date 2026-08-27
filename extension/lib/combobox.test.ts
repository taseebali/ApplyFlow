import { beforeEach, describe, expect, it } from 'vitest';
import { isCombobox, pickOptionText } from './combobox';

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

describe('pickOptionText', () => {
  const OPTIONS = ['EU citizen', 'Permanent resident', 'Student visa holder', 'Requires sponsorship'];

  it('matches the same words in a different order', () => {
    // The form says "Immediately Available"; the profile says the reverse.
    const opts = ['Not available', 'Immediately Available', '3 months'];
    expect(pickOptionText(opts, 'Available Immediately')).toBe(1);
  });

  it('prefers an exact match over a looser one', () => {
    expect(pickOptionText(['Yes, remote', 'Yes'], 'Yes')).toBe(1);
  });

  it('ignores case and punctuation differences', () => {
    expect(pickOptionText(['YES.', 'No'], 'yes')).toBe(0);
  });

  it('returns -1 when nothing sensibly matches', () => {
    // "Yes" against work-authorisation options is a real case: the profile
    // stores a yes/no but the form wants a status.
    expect(pickOptionText(OPTIONS, 'Yes')).toBe(-1);
  });

  it('matches a status option when the profile holds one', () => {
    expect(pickOptionText(OPTIONS, 'Student visa holder')).toBe(2);
  });
});
