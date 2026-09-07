/**
 * What a control will actually accept, read off the page.
 *
 * Matching used to guess a string and hope the form took it. That works for a
 * text box and fails for anything with a fixed set of answers — the location
 * field on the posting that started this is a combobox with no native
 * `<select>` behind it, so there was nothing to read a value from and nothing
 * to check a guess against. Meanwhile the page was displaying the exact list of
 * answers it would accept.
 *
 * So read the list. A field we can fill gets checked against it; a field we
 * cannot gets its options shown in the panel, so the answer is one click away
 * instead of a trip to the page.
 */

/** More than this and it is a country list, not a choice worth showing. */
const MAX_OPTIONS = 40;

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The placeholder row every select opens with is not one of the answers. */
function isPlaceholder(text: string, value: string): boolean {
  if (!value) return true;
  return /^(select|choose|pick|please select|--|-|none|n\/a)\b/i.test(text);
}

function fromSelect(element: HTMLSelectElement): string[] {
  return Array.from(element.options)
    .map((option) => ({ text: clean(option.textContent), value: option.value }))
    .filter(({ text, value }) => text.length > 0 && !isPlaceholder(text, value))
    .map(({ text }) => text);
}

/**
 * Escaped by hand rather than with CSS.escape, which is not defined in every
 * environment this runs in. Quotes and backslashes are all that can break out
 * of an attribute selector.
 */
function attr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function fromRadioGroup(element: HTMLInputElement): string[] {
  if (!element.name) return [];
  const root = element.form ?? element.ownerDocument;
  const peers = Array.from(
    root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${attr(element.name)}"]`)
  );
  return peers.map((peer) => clean(labelTextFor(peer))).filter(Boolean);
}

/** A radio's own label, which is the option text rather than the question. */
function labelTextFor(element: HTMLInputElement): string {
  const wrapping = element.closest('label');
  if (wrapping) return wrapping.textContent ?? '';
  if (element.id) {
    const bound = element.ownerDocument.querySelector(`label[for="${attr(element.id)}"]`);
    if (bound) return bound.textContent ?? '';
  }
  return element.getAttribute('aria-label') ?? element.value ?? '';
}

/**
 * A listbox a combobox points at. Every design system builds these differently,
 * so the ARIA relationships come first and a contained listbox is the fallback.
 */
function fromCombobox(element: Element): string[] {
  const document = element.ownerDocument;
  const ids = [element.getAttribute('aria-controls'), element.getAttribute('aria-owns')]
    .filter((id): id is string => Boolean(id))
    .flatMap((id) => id.split(/\s+/));

  const listboxes: Element[] = [];
  for (const id of ids) {
    const target = document.getElementById(id);
    if (target) listboxes.push(target);
  }
  if (listboxes.length === 0) {
    // Some comboboxes render the listbox as a sibling with no relationship
    // declared at all; the nearest common wrapper is the best guess available.
    const nearby = element.closest('div, fieldset, section')?.querySelector('[role="listbox"]');
    if (nearby) listboxes.push(nearby);
  }

  return listboxes
    .flatMap((listbox) => Array.from(listbox.querySelectorAll('[role="option"]')))
    .map((option) => clean(option.getAttribute('aria-label') ?? option.textContent))
    .filter(Boolean);
}

function fromDatalist(element: HTMLInputElement): string[] {
  const id = element.getAttribute('list');
  if (!id) return [];
  const list = element.ownerDocument.getElementById(id);
  if (!(list instanceof HTMLDataListElement)) return [];
  return Array.from(list.options)
    .map((option) => clean(option.value || option.textContent))
    .filter(Boolean);
}

/**
 * The answers this control offers, or an empty list when it is free text.
 *
 * Deduplicated and capped: a country dropdown is not a choice the panel should
 * try to display, and showing the first forty of it would be worse than showing
 * none.
 */
export function optionsFor(element: Element): string[] {
  let found: string[] = [];

  if (element instanceof HTMLSelectElement) found = fromSelect(element);
  else if (element instanceof HTMLInputElement && element.type === 'radio') found = fromRadioGroup(element);
  else if (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-haspopup') === 'listbox') {
    found = fromCombobox(element);
  }

  if (found.length === 0 && element instanceof HTMLInputElement) found = fromDatalist(element);

  const unique = [...new Set(found)];
  return unique.length > MAX_OPTIONS ? [] : unique;
}

/**
 * The option that matches what we would write, if one does.
 *
 * Exact first, then case-insensitive, then either containing the other — a
 * form offering "Berlin, Germany" should accept a profile that says "Berlin",
 * and one offering "Yes" should accept "yes".
 */
export function matchOption(options: string[], wanted: string): string | null {
  const value = wanted.trim();
  if (!value || options.length === 0) return null;

  const exact = options.find((option) => option === value);
  if (exact) return exact;

  const lower = value.toLowerCase();
  const insensitive = options.find((option) => option.toLowerCase() === lower);
  if (insensitive) return insensitive;

  const contained = options.filter(
    (option) => option.toLowerCase().includes(lower) || lower.includes(option.toLowerCase())
  );
  // Only when it is unambiguous. "Berlin" against both "Berlin" and "Berlin
  // (remote)" is a choice for the user, not for us.
  return contained.length === 1 ? contained[0]! : null;
}
