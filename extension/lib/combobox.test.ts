import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isCombobox, pickOptionText, visibleOptions } from './combobox';

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

describe('pickOptionText with synonyms', () => {
  it('matches a plain Yes against a sentence-form option', () => {
    const opts = ['I am authorised to work in Germany', 'I am not', 'Requires sponsorship'];
    // Not an exact, word-set, prefix or containment match — only the
    // synonym table connects these.
    expect(pickOptionText(opts, 'Yes')).toBe(-1);
    expect(pickOptionText(['I am', 'I do not'], 'Yes')).toBe(0);
  });

  it('matches availability phrasings that share no word order', () => {
    expect(pickOptionText(['3 months', 'Right away', '1 month'], 'Immediately')).toBe(1);
  });

  it('matches a CEFR level against its prose label', () => {
    expect(pickOptionText(['Beginner', 'Advanced', 'Native'], 'C1')).toBe(1);
  });

  it('still refuses an unrelated option', () => {
    expect(pickOptionText(['EU citizen', 'Permanent resident'], 'Bachelor of Science')).toBe(-1);
  });
});

// The option list decides what the extension clicks, and a click activates
// links and submit buttons for real. A page must not be able to aim it.
describe('visibleOptions', () => {
  // jsdom does no layout, so every element reads as invisible. Give them all a
  // box; visibility is not what these tests are about.
  const original = Element.prototype.getClientRects;
  beforeEach(() => {
    Element.prototype.getClientRects = function () {
      return [{ width: 10, height: 10 }] as unknown as DOMRectList;
    };
  });
  afterEach(() => {
    Element.prototype.getClientRects = original;
  });

  it('only looks inside the menu the widget points at', () => {
    setBody(`
      <div class="select__container">
        <input role="combobox" aria-controls="menu-1" />
      </div>
      <div id="menu-1"><div role="option">Berlin</div><div role="option">Munich</div></div>
      <div id="elsewhere"><div role="option">Hamburg</div></div>
    `);
    const texts = visibleOptions(first()).map((el) => el.textContent);
    expect(texts).toEqual(['Berlin', 'Munich']);
  });

  it('refuses to treat a submit button as a selectable option', () => {
    setBody(`
      <div class="select__container">
        <input role="combobox" aria-controls="menu-1" />
      </div>
      <div id="menu-1">
        <button type="submit" role="option">Berlin</button>
        <div role="option">Munich</div>
      </div>
    `);
    expect(visibleOptions(first()).map((el) => el.textContent)).toEqual(['Munich']);
  });

  it('refuses to treat a link as a selectable option', () => {
    setBody(`
      <div class="select__container">
        <input role="combobox" aria-controls="menu-1" />
      </div>
      <div id="menu-1"><a href="https://evil.test" role="option">Berlin</a><div role="option">Munich</div></div>
    `);
    expect(visibleOptions(first()).map((el) => el.textContent)).toEqual(['Munich']);
  });

  it('still finds a portalled menu when the widget names no owner', () => {
    setBody(`
      <div class="select__container"><input role="combobox" /></div>
      <div class="select__menu"><div class="select__option">Berlin</div></div>
    `);
    expect(visibleOptions(first()).map((el) => el.textContent)).toEqual(['Berlin']);
  });
});
