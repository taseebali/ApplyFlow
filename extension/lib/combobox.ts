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

/** Lets the page's framework re-render between steps; a menu never appears synchronously. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60));
}

function visibleOptions(): HTMLElement[] {
  const selector = '[role="option"], [class*="select__option"], [class*="-option"]';
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0
  );
}

/** Prefers an exact match, then a prefix, then a containment — never a random near-miss. */
function pickOption(options: HTMLElement[], value: string): HTMLElement | undefined {
  const target = normalizeText(value);
  if (!target) return undefined;
  const texts = options.map((el) => ({ el, text: normalizeText(el.textContent ?? '') }));
  return (
    texts.find((o) => o.text === target)?.el ??
    texts.find((o) => o.text.startsWith(target))?.el ??
    texts.find((o) => o.text.includes(target))?.el ??
    texts.find((o) => target.includes(o.text) && o.text.length > 2)?.el
  );
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
export async function fillCombobox(input: HTMLInputElement, value: string): Promise<boolean> {
  const control = controlFor(input);

  input.focus();
  dispatchMouse(control, ['pointerdown', 'mousedown', 'mouseup', 'click']);
  await nextFrame();

  // Typing filters long lists (country pickers run to 200+ entries) and is
  // also what opens the menu on widgets that ignore the click above.
  setNativeFieldValue(input, value);
  await nextFrame();

  const option = pickOption(visibleOptions(), value);
  if (option) {
    dispatchMouse(option, ['pointerdown', 'mousedown', 'mouseup', 'click']);
  } else {
    // No menu we can see — let the widget commit whatever it highlighted.
    for (const type of ['keydown', 'keyup']) {
      input.dispatchEvent(
        new KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 })
      );
    }
  }

  await nextFrame();
  const selected = hasSelection(input);
  if (!selected) {
    // Leave nothing half-typed in a search box the user might then submit.
    setNativeFieldValue(input, '');
  }
  return selected;
}
