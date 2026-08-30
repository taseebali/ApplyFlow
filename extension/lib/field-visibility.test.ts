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
