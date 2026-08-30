/**
 * Checks a written value against the rules the form itself declares.
 *
 * A field was counted as "filled" the moment a value was written into it. But
 * a form can demand its own format — a `pattern`, a `type=email`, a length cap
 * — and the value we wrote may not satisfy it. The user then discovers the
 * problem at submit time, on a field they never typed into, with an error that
 * points nowhere useful.
 *
 * "Written but rejected" is a different outcome from "filled", and counting
 * them together overstated how well filling worked.
 */

export type Writable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface ValidationProblem {
  label: string;
  reason: string;
}

/** Trims a value to the form's own limit rather than letting it be truncated silently. */
export function fitToMaxLength(value: string, element: Writable): string {
  const max = 'maxLength' in element ? element.maxLength : -1;
  return max > 0 && value.length > max ? value.slice(0, max) : value;
}

/**
 * Reformats a value where the form's declared type makes the intent obvious.
 * Deliberately conservative: only transformations that cannot lose meaning.
 */
export function adaptToField(value: string, element: Writable): string {
  const trimmed = value.trim();
  if (!(element instanceof HTMLInputElement)) return fitToMaxLength(trimmed, element);

  if (element.type === 'date') {
    // A date input only accepts yyyy-mm-dd. Profile dates are often "2027" or
    // "Aug 2027", which the field silently refuses.
    const parsed = toIsoDate(trimmed);
    if (parsed) return parsed;
  }

  if (element.type === 'tel') {
    // Some forms reject spaces in a phone number and accept nothing else.
    const compact = trimmed.replace(/[^\d+]/g, '');
    if (element.pattern) {
      try {
        // The pattern comes from the page and may not even be a valid regex.
        // Building it outside this try meant one malformed attribute threw out
        // of the whole fill.
        const rule = new RegExp(`^(?:${element.pattern})$`);
        if (!rule.test(trimmed) && rule.test(compact)) return compact;
      } catch {
        // A broken pattern in the page is not ours to fix; leave the value be.
      }
    }
  }

  return fitToMaxLength(trimmed, element);
}

/** Turns the loose date formats a profile holds into yyyy-mm-dd, when it can. */
export function toIsoDate(value: string): string | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return value;

  const dmy = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);

  return null;
}

/**
 * Whether the field accepted what was written. Uses the browser's own
 * constraint validation, so it agrees with what the form will do on submit.
 */
export function validateWritten(element: Writable, label: string): ValidationProblem | null {
  // Not every element implements constraint validation (and jsdom does so
  // partially), so a missing API means "no opinion", not "invalid".
  if (typeof element.checkValidity !== 'function') return null;
  if (element.checkValidity()) return null;

  const validity = element.validity as ValidityState | undefined;
  let reason = 'the form rejected this value';

  if (validity?.patternMismatch) reason = 'the form wants a different format here';
  else if (validity?.typeMismatch) reason = `the form expects a valid ${(element as HTMLInputElement).type}`;
  else if (validity?.tooLong) reason = 'the value is longer than the form allows';
  else if (validity?.rangeUnderflow || validity?.rangeOverflow) reason = 'the value is outside the allowed range';
  else if (validity?.valueMissing) reason = 'the form still considers this empty';

  return { label, reason };
}
