import { normalizeText } from './field-matcher';
import { setNativeFieldValue } from './filler';

/**
 * Modern ATSs (Greenhouse's current forms among them) render every dropdown
 * as a scripted combobox rather than a `<select>`: a text input plus a menu
 * built from divs. Setting `.value` on one types into its search box and
 * selects nothing, so these need to be driven the way a person drives them.
 */
export function isCombobox(el: Element): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.getAttribute('role') === 'combobox') return true;
  if (el.getAttribute('aria-haspopup') === 'listbox') return true;
  if (el.getAttribute('aria-autocomplete') === 'list') return true;
  return Boolean(el.closest('[class*="select__control"], [class*="select__container"]'));
}

/** The clickable shell around the input — clicking it is what opens the menu. */
function controlFor(input: HTMLInputElement): Element {
  return (
    input.closest('[class*="select__control"]') ??
    input.closest('[class*="select__container"]') ??
    input.parentElement ??
    input
  );
}

function dispatchMouse(target: Element, types: string[]) {
  for (const type of types) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits for the menu to appear rather than assuming one render is enough.
 * How long a framework takes to open a dropdown varies with the page, and a
 * fixed delay either wastes time or misses the menu entirely.
 */
async function waitForOptions(timeoutMs = 900): Promise<HTMLElement[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const options = visibleOptions();
    if (options.length) return options;
    if (Date.now() > deadline) return [];
    await wait(80);
  }
}

function visibleOptions(): HTMLElement[] {
  const selector = '[role="option"], [class*="select__option"], [class*="-option"]';
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0
  );
}

const sortedWords = (text: string) => text.split(' ').filter(Boolean).sort().join(' ');

/**
 * Prefers an exact match, then same-words-any-order, then a prefix or
 * containment — never a random near-miss. The word-order pass matters because
 * forms and profiles disagree constantly on phrasing: "Available Immediately"
 * against "Immediately Available" is the same answer written the other way up.
 */
export function pickOptionText(optionTexts: string[], value: string): number {
  const target = normalizeText(value);
  if (!target) return -1;
  const texts = optionTexts.map(normalizeText);
  const targetWords = sortedWords(target);

  const byExact = texts.indexOf(target);
  if (byExact !== -1) return byExact;

  const byWords = texts.findIndex((t) => sortedWords(t) === targetWords);
  if (byWords !== -1) return byWords;

  const byPrefix = texts.findIndex((t) => t.startsWith(target));
  if (byPrefix !== -1) return byPrefix;

  const byContains = texts.findIndex((t) => t.includes(target));
  if (byContains !== -1) return byContains;

  return texts.findIndex((t) => t.length > 2 && target.includes(t));
}

function pickOption(options: HTMLElement[], value: string): HTMLElement | undefined {
  const index = pickOptionText(
    options.map((el) => el.textContent ?? ''),
    value
  );
  return index === -1 ? undefined : options[index];
}

/** Whether the widget now displays a chosen value rather than its placeholder. */
function hasSelection(input: HTMLInputElement): boolean {
  const container = input.closest('[class*="select__container"], [class*="select-shell"]') ?? controlFor(input);
  if (container.querySelector('[class*="single-value"], [class*="multi-value"]')) return true;
  // Some widgets simply write the chosen label back into the input.
  return input.value.trim().length > 0;
}

/**
 * Fills a scripted dropdown by opening it, narrowing the list, and choosing
 * the matching option. Returns whether a value actually ended up selected —
 * reporting a fill that did not happen is worse than reporting a miss.
 */
export interface ComboboxResult {
  ok: boolean;
  /**
   * Why a fill failed, in words worth showing the user. Filling these widgets
   * cannot be tested outside a real browser, so when it fails it has to say
   * where it got to rather than just reporting nothing happened.
   */
  reason?: string;
}

export async function fillCombobox(input: HTMLInputElement, value: string): Promise<ComboboxResult> {
  const control = controlFor(input);

  input.focus();
  dispatchMouse(control, ['pointerdown', 'mousedown', 'mouseup', 'click']);

  let options = await waitForOptions();
  if (!options.length) {
    // Typing both filters long lists and opens widgets that ignored the click.
    setNativeFieldValue(input, value);
    options = await waitForOptions();
  }

  if (!options.length) {
    await abandon(input);
    return { ok: false, reason: 'the dropdown did not open' };
  }

  const option = pickOption(options, value);
  if (!option) {
    const sample = options
      .slice(0, 4)
      .map((o) => (o.textContent ?? '').trim())
      .filter(Boolean)
      .join(', ');
    await abandon(input);
    return { ok: false, reason: `no option matched "${value}" (offered: ${sample})` };
  }

  dispatchMouse(option, ['pointerdown', 'mousedown', 'mouseup', 'click']);
  await wait(120);

  if (hasSelection(input)) return { ok: true };

  // Clicking did not take; let the widget commit its highlighted option.
  for (const type of ['keydown', 'keyup']) {
    input.dispatchEvent(
      new KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 })
    );
  }
  await wait(120);

  if (hasSelection(input)) return { ok: true };
  await abandon(input);
  return { ok: false, reason: `found "${value}" in the list but the choice did not stick` };
}

/**
 * Leaves the widget as we found it: nothing half-typed in a search box the
 * user might submit, and no menu hanging open over the fields below.
 */
async function abandon(input: HTMLInputElement): Promise<void> {
  setNativeFieldValue(input, '');
  input.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape', code: 'Escape', keyCode: 27 })
  );
  input.blur();
  await wait(40);
}
