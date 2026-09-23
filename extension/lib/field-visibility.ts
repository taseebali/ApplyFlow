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
 * Anything below this reads as hidden rather than as a styling choice.
 * 0.5 is a design decision; 0.05 is a field nobody can see.
 */
const MIN_VISIBLE_OPACITY = 0.05;

/**
 * Whether a field is hidden from the user.
 *
 * The check has to walk the ancestors, not just read the field's own style,
 * because that is how pages actually hide things. Measured in Chrome, for an
 * input inside a wrapper:
 *
 * | wrapper style        | the input's own computed style | rects |
 * |----------------------|--------------------------------|-------|
 * | `display: none`      | `display: inline-block`        | 0     |
 * | `opacity: 0`         | `opacity: 1`                   | 1     |
 * | `visibility: hidden` | `visibility: hidden`           | 1     |
 *
 * Only `visibility` inherits, so only that one was ever caught. `display` and
 * `opacity` do not, and the zero-rect case fell through a guard meant for
 * jsdom straight to "visible" — so a honeypot in a hidden wrapper was filled
 * and the application binned, and a hostile page could have a column of hidden
 * EEO, address and date-of-birth fields filled in and read straight back.
 *
 * Still conservative about what it cannot measure: a document that was never
 * laid out at all (jsdom, a detached tree) reports no rects for everything,
 * and hiding the whole form there would be worse than filling a decoy.
 */
export function isHiddenField(element: HTMLElement): boolean {
  if (element.closest('[hidden]')) return true;
  if (element.closest('[aria-hidden="true"]')) return true;

  const view = element.ownerDocument?.defaultView;

  /*
   * The browser's own answer, where there is one. `checkVisibility` accounts
   * for ancestors, content-visibility and opacity in one call and is exactly
   * the question being asked. Chrome 125+; jsdom has no implementation, so
   * the manual walk below remains the path the tests take.
   */
  if (typeof element.checkVisibility === 'function') {
    const visible = element.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
      contentVisibilityAuto: true,
    });
    if (!visible) return true;
  }

  if (view) {
    // Up to the document. A wrapper anywhere above can hide the field, and
    // the chain is short enough that walking all of it costs nothing.
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (!style) break;
      if (style.display === 'none') return true;
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
      const opacity = Number.parseFloat(style.opacity);
      if (Number.isFinite(opacity) && opacity < MIN_VISIBLE_OPACITY) return true;
    }
  }

  const rects = element.getClientRects();
  if (rects.length > 0) {
    const rect = rects[0]!;
    if (rect.width === 0 || rect.height === 0) return true;
    // Parked off-screen. The comment here used to claim this was covered when
    // only zero-size was; `position:absolute;left:-9999px` is the commonest
    // honeypot of all and reported a full-size 169x21 box.
    if (view && (rect.right <= 0 || rect.bottom <= 0 || rect.left >= view.innerWidth)) return true;
  }

  return false;
}

/** True when a field should be left alone entirely: not filled, not drafted. */
export function isOffLimits(element: HTMLElement): boolean {
  return isBotField(element) || isHiddenField(element);
}
