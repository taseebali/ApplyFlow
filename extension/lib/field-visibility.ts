/**
 * Fields that exist in the DOM but are not for the user to fill.
 *
 * Two distinct hazards, both of which the extension was walking straight into:
 *
 * 1. **Bot checks.** reCAPTCHA puts a `<textarea name="g-recaptcha-response">`
 *    on the page with `display: none`. Being a textarea, it counted as
 *    inherently open-ended, and with no label the field name became the
 *    "question" — so a model was asked to write an essay about
 *    "g-recaptcha-response".
 * 2. **Honeypots.** Application forms hide decoy fields with ordinary names
 *    like `email` or `url` and discard any submission that fills them. This is
 *    the more serious one: a hidden decoy matches the profile schema happily,
 *    and the application is silently binned with no error shown to anyone.
 *
 * Both are avoided by the same rule — never touch a field the user cannot see.
 */

/** Names and ids that identify a field as machinery rather than a question. */
const BOT_FIELD_PATTERN =
  /(?:^|[^a-z])(?:(?:g-|h-|cf-)?(?:re)?captcha|turnstile|honeypot|csrf|authenticity[-_]?token|__requestverificationtoken)/i;

export function isBotField(element: Element): boolean {
  const name = element.getAttribute('name') ?? '';
  const id = element.getAttribute('id') ?? '';
  const cls = element.getAttribute('class') ?? '';
  return BOT_FIELD_PATTERN.test(name) || BOT_FIELD_PATTERN.test(id) || BOT_FIELD_PATTERN.test(cls);
}

/**
 * Whether a field is hidden from the user. Deliberately conservative: it
 * reports hidden only on positive evidence, so a field this cannot measure is
 * still offered rather than silently dropped.
 */
export function isHiddenField(element: HTMLElement): boolean {
  if (element.hasAttribute('hidden')) return true;
  if (element.getAttribute('aria-hidden') === 'true') return true;

  const view = element.ownerDocument?.defaultView;
  const style = view?.getComputedStyle(element);
  if (style) {
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return true;
    if (style.opacity === '0') return true;
  }

  // An element laid out at zero size, or moved far off-screen, is hidden in
  // every way that matters. Guarded on there being rects at all, because a
  // document that was never laid out (jsdom, a detached tree) reports none for
  // everything and would otherwise hide the whole form.
  const rects = element.getClientRects();
  if (rects.length > 0) {
    const rect = rects[0]!;
    if (rect.width === 0 || rect.height === 0) return true;
  }

  return false;
}

/** True when a field should be left alone entirely: not filled, not drafted. */
export function isOffLimits(element: HTMLElement): boolean {
  return isBotField(element) || isHiddenField(element);
}
