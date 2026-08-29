import { getDisplayLabel, normalizeText } from './field-matcher';
import { meansTheSame } from './option-synonyms';
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
async function waitForOptions(input: HTMLInputElement, timeoutMs = 900): Promise<HTMLElement[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const options = visibleOptions(input);
    if (options.length) return options;
    if (Date.now() > deadline) return [];
    await wait(80);
  }
}

function pressKey(el: HTMLElement, key: string, keyCode: number): void {
  for (const type of ['keydown', 'keyup']) {
    el.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key, code: key, keyCode }));
  }
}

/**
 * Walks the list with the arrow keys, reading whichever option the widget
 * marks as active. Some dropdowns render their menu somewhere we cannot find
 * by selector — into a portal, a shadow root, or with class names we do not
 * recognise — and without this those are an unconditional failure even though
 * a keyboard user could fill them fine.
 */
async function enumerateByKeyboard(input: HTMLInputElement, limit = 40): Promise<string[]> {
  const seen: string[] = [];

  for (let i = 0; i < limit; i += 1) {
    pressKey(input, 'ArrowDown', 40);
    await wait(30);

    const activeId = input.getAttribute('aria-activedescendant');
    const text = (activeId ? document.getElementById(activeId)?.textContent : '')?.trim();
    if (!text) break;
    // The highlight wraps around at the end of the list.
    if (seen.includes(text)) break;
    seen.push(text);
  }

  return seen;
}

const OPTION_SELECTOR = '[role="option"], [class*="select__option"], [class*="-option"]';

/**
 * The menu of a portalled combobox genuinely can render outside the input's
 * subtree, which is why this once searched the whole document — but a
 * document-wide search lets the page decide what gets clicked. A hidden
 * `<button type="submit" role="option">Berlin</button>` anywhere on the page
 * would match a saved city and turn "fill" into "submit".
 *
 * So: prefer the menu the widget itself points at, then its own container, and
 * only fall back to the document when neither exists — and in every case never
 * activate something that navigates or submits.
 */
function optionRoot(input: HTMLInputElement): ParentNode {
  const owned = input.getAttribute('aria-controls') ?? input.getAttribute('aria-owns');
  const ownedEl = owned ? document.getElementById(owned) : null;
  if (ownedEl) return ownedEl;

  const container = input.closest('[class*="select__container"], [class*="select__control"], [class*="-container"]');
  return container?.parentElement ?? document;
}

export function visibleOptions(input: HTMLInputElement): HTMLElement[] {
  return Array.from(optionRoot(input).querySelectorAll<HTMLElement>(OPTION_SELECTOR))
    .filter((el) => !el.closest('a[href], button[type="submit"], input[type="submit"], form button:not([type])'))
    .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
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

  // Forms and profiles disagree on wording constantly ("Yes" against "I am
  // authorised to work here"), so recorded equivalences are checked before
  // falling back to looser string overlap.
  const bySynonym = texts.findIndex((t) => meansTheSame(t, target));
  if (bySynonym !== -1) return bySynonym;

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

/** The question this dropdown is asking, so an AI fallback has the context. */
function labelFor(input: HTMLInputElement): string {
  return getDisplayLabel(input);
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
   * Set when the option was picked by the model rather than by deterministic
   * matching. The user is shown these so a model's choice is never committed
   * to a real application without them seeing what it was.
   */
  chosenByAi?: string;
  /**
   * Why a fill failed, in words worth showing the user. Filling these widgets
   * cannot be tested outside a real browser, so when it fails it has to say
   * where it got to rather than just reporting nothing happened.
   */
  reason?: string;
}

export async function fillCombobox(
  input: HTMLInputElement,
  value: string,
  /** Used only when nothing deterministic matched, so a normal form costs nothing. */
  aiFallback?: (question: string, options: string[], value: string) => Promise<number>
): Promise<ComboboxResult> {
  const control = controlFor(input);

  input.focus();
  dispatchMouse(control, ['pointerdown', 'mousedown', 'mouseup', 'click']);

  let options = await waitForOptions(input);
  if (!options.length) {
    // Typing both filters long lists and opens widgets that ignored the click.
    setNativeFieldValue(input, value);
    options = await waitForOptions(input);
  }

  if (!options.length) {
    // The menu is open but not findable by selector. Walk it with the arrow
    // keys instead and commit with Enter, which needs no menu DOM at all.
    const keyboardOptions = await enumerateByKeyboard(input);
    if (keyboardOptions.length) {
      const index = pickOptionText(keyboardOptions, value);
      if (index === -1) {
        await abandon(input);
        return {
          ok: false,
          reason: `no option matched "${value}" (offered: ${keyboardOptions.slice(0, 4).join(', ')})`,
        };
      }
      // The highlight is currently on the last option we read, so step back
      // round to the one we want.
      const stepsBack = keyboardOptions.length - 1 - index;
      for (let i = 0; i < stepsBack; i += 1) {
        pressKey(input, 'ArrowUp', 38);
        await wait(30);
      }
      pressKey(input, 'Enter', 13);
      await wait(120);
      if (hasSelection(input)) return { ok: true };
    }

    await abandon(input);
    return { ok: false, reason: 'the dropdown did not open' };
  }

  const optionTexts = options.map((o) => (o.textContent ?? '').trim());
  let option = pickOption(options, value);
  let chosenByAi: string | undefined;

  if (!option && aiFallback) {
    // Deterministic matching has run out; ask which option means this.
    const index = await aiFallback(labelFor(input), optionTexts, value);
    if (index >= 0) {
      option = options[index];
      chosenByAi = optionTexts[index];
    }
  }

  if (!option) {
    const sample = optionTexts.filter(Boolean).slice(0, 4).join(', ');
    await abandon(input);
    return { ok: false, reason: `no option matched "${value}" (offered: ${sample})` };
  }

  dispatchMouse(option, ['pointerdown', 'mousedown', 'mouseup', 'click']);
  await wait(120);

  if (hasSelection(input)) return { ok: true, chosenByAi };

  // Clicking did not take; let the widget commit its highlighted option.
  for (const type of ['keydown', 'keyup']) {
    input.dispatchEvent(
      new KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 })
    );
  }
  await wait(120);

  if (hasSelection(input)) return { ok: true, chosenByAi };
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
