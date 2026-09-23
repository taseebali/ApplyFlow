import { describe, expect, it } from 'vitest';
import { isBotField, isHiddenField, isOffLimits } from './field-visibility';

function build(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

describe('isBotField', () => {
  it('recognises the reCAPTCHA response field that was being drafted as a question', () => {
    expect(isBotField(build('<textarea name="g-recaptcha-response"></textarea>'))).toBe(true);
  });

  it('recognises other bot checks by name, id, or class', () => {
    expect(isBotField(build('<input name="h-captcha-response">'))).toBe(true);
    expect(isBotField(build('<input id="cf-turnstile-response">'))).toBe(true);
    expect(isBotField(build('<textarea class="g-recaptcha-response"></textarea>'))).toBe(true);
    expect(isBotField(build('<input name="csrf_token">'))).toBe(true);
  });

  it('leaves ordinary fields alone', () => {
    expect(isBotField(build('<input name="email">'))).toBe(false);
    expect(isBotField(build('<textarea name="cover_letter"></textarea>'))).toBe(false);
  });

  it('does not fire on a word that merely contains a match', () => {
    expect(isBotField(build('<input name="decaptchalize">'))).toBe(false);
  });
});

describe('isHiddenField', () => {
  it('treats display:none as hidden', () => {
    expect(isHiddenField(build('<textarea style="display:none"></textarea>'))).toBe(true);
  });

  it('treats visibility:hidden and opacity:0 as hidden', () => {
    expect(isHiddenField(build('<input style="visibility:hidden">'))).toBe(true);
    expect(isHiddenField(build('<input style="opacity:0">'))).toBe(true);
  });

  it('honours the hidden attribute and aria-hidden', () => {
    expect(isHiddenField(build('<input hidden>'))).toBe(true);
    expect(isHiddenField(build('<input aria-hidden="true">'))).toBe(true);
  });

  it('treats an ordinary visible field as visible', () => {
    expect(isHiddenField(build('<input name="email">'))).toBe(false);
  });

  it('does not hide everything in a document that was never laid out', () => {
    // jsdom reports no client rects at all; the guard must not read that as
    // "the entire form is invisible".
    expect(isHiddenField(build('<textarea></textarea>'))).toBe(false);
  });
});

describe('isOffLimits', () => {
  it('catches a honeypot wearing an ordinary name', () => {
    // The dangerous case: a hidden decoy the schema matcher would happily fill,
    // after which the application is silently discarded.
    expect(isOffLimits(build('<input name="email" style="display:none">'))).toBe(true);
  });

  it('leaves a real field alone', () => {
    expect(isOffLimits(build('<input name="email">'))).toBe(false);
  });
});

describe('hidden by an ancestor rather than by itself', () => {
  /*
   * Measured in Chrome, because jsdom does no layout and cannot show this:
   *
   *   ancestor display:none    → getComputedStyle(input).display = "inline-block",
   *                              getClientRects().length = 0
   *   ancestor opacity:0       → getComputedStyle(input).opacity = "1"
   *   position left:-9999px    → one rect, 169x21, left -9999
   *   ancestor visibility:hidden → "hidden" (visibility inherits — the one that worked)
   *
   * So three of the four ways a page hides a field got through: the check read
   * only the field's own style, and skipped the rect test whenever there were
   * no rects at all. Both honeypots (the application is binned) and deliberate
   * harvesting (a hidden EEO or address field is filled and read back) depend
   * on exactly that.
   */
  it('sees through a display:none wrapper', () => {
    document.body.innerHTML = '<div style="display:none"><input id="a" name="dob"></div>';
    expect(isHiddenField(document.getElementById('a') as HTMLElement)).toBe(true);
  });

  it('sees through an opacity:0 wrapper', () => {
    document.body.innerHTML = '<div style="opacity:0"><input id="a" name="ssn"></div>';
    expect(isHiddenField(document.getElementById('a') as HTMLElement)).toBe(true);
  });

  it('sees through a wrapper hidden further up than the parent', () => {
    document.body.innerHTML = '<div style="display:none"><fieldset><div><input id="a"></div></fieldset></div>';
    expect(isHiddenField(document.getElementById('a') as HTMLElement)).toBe(true);
  });

  it('still treats an ordinary nested field as visible', () => {
    document.body.innerHTML = '<div><fieldset><div><input id="a"></div></fieldset></div>';
    expect(isHiddenField(document.getElementById('a') as HTMLElement)).toBe(false);
  });

  it('does not hide a field merely because an ancestor is partly transparent', () => {
    // 0.5 is a styling choice, not a hiding technique.
    document.body.innerHTML = '<div style="opacity:0.5"><input id="a"></div>';
    expect(isHiddenField(document.getElementById('a') as HTMLElement)).toBe(false);
  });
});
