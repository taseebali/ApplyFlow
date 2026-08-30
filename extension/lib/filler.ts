import { getRadioOptionLabel, normalizeText, type FieldMatch, type RadioGroupMatch } from './field-matcher';
import { fillCombobox, isCombobox } from './combobox';
import { inferAnswer } from './inference';
import { matchesBooleanAnswer } from './option-synonyms';
import { SCHEMA_FIELDS, type Profile } from './schema';

export interface FillResult {
  filledCount: number;
  skippedCount: number;
  /** Labels of fields we recognized but couldn't fill (usually: no data for that field yet). */
  skippedLabels: string[];
  /** Dropdowns where the model, not deterministic matching, picked the option. */
  aiChoices: Array<{ label: string; answer: string }>;
}

function getValueKind(path: string): 'text' | 'boolean' | 'preference' {
  return SCHEMA_FIELDS.find((f) => f.path === path)?.valueKind ?? 'text';
}

function getRawByPath(profile: Profile, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, profile);
}

/**
 * The qualification a form is asking about is the one in progress, or failing
 * that the most recently finished one — not whichever happens to be first in
 * the list.
 */
function primaryEducation(profile: Profile) {
  const inProgress = profile.education.find((e) => e.current);
  if (inProgress) return inProgress;
  return [...profile.education].sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''))[0];
}

/** Text-valued fields, including ones derived rather than stored directly on Profile. */
function resolveText(profile: Profile, path: string): string | undefined {
  if (path === 'contact.fullName') {
    const full = `${profile.contact.firstName} ${profile.contact.lastName}`.trim();
    return full.length > 0 ? full : undefined;
  }
  if (path === 'logistics.hearAboutUs') {
    return profile.logistics.hearAboutUsPreferences[0];
  }
  if (path === 'languages.list') {
    return profile.languages.map((l) => l.language).filter(Boolean).join(', ') || undefined;
  }
  if (path === 'languages.german') {
    // Forms ask for one language's level at a time; answer with the level
    // rather than the language name.
    const german = profile.languages.find((l) => /german|deutsch/i.test(l.language));
    return german?.level || undefined;
  }
  if (path.startsWith('education.')) {
    const entry = primaryEducation(profile);
    if (!entry) return undefined;
    // "Expected graduation date" is the end date of the course being studied.
    if (path === 'education.graduationDate') return entry.endDate || undefined;
    if (path === 'education.school') return entry.school || undefined;
    if (path === 'education.degree') return entry.degree || undefined;
    if (path === 'education.fieldOfStudy') return entry.fieldOfStudy || undefined;
    return undefined;
  }
  const value = getRawByPath(profile, path);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resolveBoolean(profile: Profile, path: string): boolean | null {
  const value = getRawByPath(profile, path);
  return typeof value === 'boolean' ? value : null;
}

function resolvePreferenceList(profile: Profile, path: string): string[] {
  if (path === 'logistics.hearAboutUs') return profile.logistics.hearAboutUsPreferences;
  return [];
}

function dispatchChange(el: HTMLElement) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * React (and similar frameworks) patch the *instance* value/checked setter to
 * track edits, so `el.value = x` silently no-ops from React's perspective —
 * the DOM shows the new value for an instant, then React's next render wipes
 * it back to its own (unchanged) state. Calling the *prototype's* setter
 * bypasses that instance patch, so the framework's change tracker correctly
 * sees a diff once we dispatch the input/change events below.
 */
type Writable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * What each field held before this fill touched it.
 *
 * One click changes thirty fields at once, on a live application that may
 * autosave. Without this the only remedy for a wrong value is to find and
 * retype it by hand. Every write goes through `setNativeValue`, so recording
 * here catches text fields, native selects, radios, and comboboxes alike.
 *
 * Element references cannot be serialised, so the journal lives in the frame
 * that did the writing and dies with the page — which is correct: once the
 * page is gone, there is nothing left to undo.
 */
let writeJournal: Array<{ element: Writable; previous: string }> = [];

export function beginFillJournal(): void {
  writeJournal = [];
}

export function journalSize(): number {
  return writeJournal.length;
}

/**
 * Puts back what was there before, most recent first so a field written twice
 * ends on its original value. Returns how many fields were restored.
 */
export function undoFill(): number {
  let restored = 0;
  for (const entry of [...writeJournal].reverse()) {
    // The field may have been removed by a step change; skip rather than throw.
    if (!entry.element.isConnected) continue;
    setNativeValue(entry.element, entry.previous);
    dispatchChange(entry.element);
    restored++;
  }
  writeJournal = [];
  return restored;
}

function setNativeValue(el: Writable, value: string) {
  // Recorded before the write, and only the first time a field is touched, so
  // "previous" always means "before ApplyFlow", not "before the last keystroke".
  if (!writeJournal.some((entry) => entry.element === el)) {
    writeJournal.push({ element: el, previous: el.value });
  }

  const prototype =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

/** Writes a value into a field the way a real user would, so framework-controlled forms notice. */
export function setNativeFieldValue(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string
) {
  setNativeValue(el, value);
  dispatchChange(el);
}

/**
 * Why the last dropdown attempt failed. Scripted dropdowns cannot be tested
 * outside a real browser, so when one fails the panel needs to say where it
 * got to rather than reporting a bare miss.
 */
let lastComboboxReason: string | undefined;

/**
 * Set for the duration of one fill so the dropdown layer can escalate to the
 * model without every helper having to thread settings through.
 */
let aiOptionFallback: ((question: string, options: string[], value: string) => Promise<number>) | undefined;

/**
 * The option a model chose during the current field, if any. Collected the
 * same way `lastComboboxReason` is, so every fill entry point can report it
 * without threading a return value through each helper.
 */
let lastAiChoice: string | undefined;

function setNativeChecked(el: HTMLInputElement, checked: boolean) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
  if (setter) setter.call(el, checked);
  else el.checked = checked;
}

function setSelectByPredicate(el: HTMLSelectElement, matches: (optionText: string) => boolean): boolean {
  const option = Array.from(el.options).find(
    (o) => matches(normalizeText(o.text)) || matches(normalizeText(o.value))
  );
  if (!option) return false;
  setNativeValue(el, option.value);
  dispatchChange(el);
  return true;
}

function setRadioGroupByPredicate(elements: HTMLInputElement[], matches: (optionText: string) => boolean): boolean {
  const radio = elements.find((r) => matches(normalizeText(getRadioOptionLabel(r))));
  if (!radio) return false;
  setNativeChecked(radio, true);
  dispatchChange(radio);
  return true;
}

async function fillTextField(el: FieldMatch['element'], text: string): Promise<boolean> {
  // A scripted dropdown looks like a text input but ignores a plain value
  // assignment, so it has to be opened and chosen from instead.
  if (isCombobox(el)) {
    const result = await fillCombobox(el, text, aiOptionFallback);
    if (!result.ok) lastComboboxReason = result.reason;
    lastAiChoice = result.chosenByAi;
    return result.ok;
  }
  return fillPlainTextField(el, text);
}

function fillPlainTextField(el: FieldMatch['element'], text: string): boolean {
  if (el instanceof HTMLSelectElement) {
    const target = normalizeText(text);
    return setSelectByPredicate(el, (t) => t === target || t.includes(target));
  }
  setNativeValue(el, text);
  dispatchChange(el);
  return true;
}

async function fillBooleanField(el: FieldMatch['element'], value: boolean): Promise<boolean> {
  if (el instanceof HTMLSelectElement) {
    return setSelectByPredicate(el, (t) => matchesBooleanAnswer(t, value));
  }
  if (isCombobox(el)) {
    const result = await fillCombobox(el, value ? 'Yes' : 'No', aiOptionFallback);
    if (!result.ok) lastComboboxReason = result.reason;
    lastAiChoice = result.chosenByAi;
    return result.ok;
  }
  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    setNativeChecked(el, value);
    dispatchChange(el);
    return true;
  }
  return false;
}

async function fillPreferenceField(
  el: FieldMatch['element'],
  profile: Profile,
  path: string
): Promise<boolean> {
  const preferences = resolvePreferenceList(profile, path);
  if (el instanceof HTMLSelectElement) {
    for (const pref of preferences.map(normalizeText)) {
      if (setSelectByPredicate(el, (t) => t === pref || t.includes(pref))) return true;
    }
    return false;
  }
  if (isCombobox(el)) {
    // Try each acceptable answer in order; the form may offer only some.
    for (const pref of preferences) {
      const result = await fillCombobox(el, pref, aiOptionFallback);
      if (result.ok) return true;
      lastComboboxReason = result.reason;
    }
    return false;
  }
  const text = resolveText(profile, path);
  return text ? fillTextField(el, text) : false;
}

/** Fills text/select/textarea/checkbox fields matched by matchFields. */
export async function fillFields(
  matches: FieldMatch[],
  profile: Profile,
  options: { aiOptionFallback?: typeof aiOptionFallback } = {}
): Promise<FillResult> {
  aiOptionFallback = options.aiOptionFallback;
  let filledCount = 0;
  const skippedLabels: string[] = [];
  const aiChoices: FillResult['aiChoices'] = [];

  for (const match of matches) {
    const kind = getValueKind(match.path);
    let didFill = false;

    lastComboboxReason = undefined;
    lastAiChoice = undefined;
    if (kind === 'boolean') {
      const value = resolveBoolean(profile, match.path);
      if (value !== null) didFill = await fillBooleanField(match.element, value);
    } else if (kind === 'preference') {
      didFill = await fillPreferenceField(match.element, profile, match.path);
    } else {
      const text = resolveText(profile, match.path);
      if (text) didFill = await fillTextField(match.element, text);
    }

    if (didFill) {
      filledCount += 1;
      if (lastAiChoice) aiChoices.push({ label: match.label, answer: lastAiChoice });
    } else {
      skippedLabels.push(lastComboboxReason ? `${match.label} — ${lastComboboxReason}` : match.label);
    }
    lastComboboxReason = undefined;
    lastAiChoice = undefined;
  }

  return { filledCount, skippedCount: skippedLabels.length, skippedLabels, aiChoices };
}

/**
 * Fills fields the schema could not place but whose answer already follows
 * from the profile — "are you currently enrolled?", "are you based in Berlin?".
 * Runs after normal matching, so a field with a real profile field behind it
 * always wins over an inferred answer.
 */
export async function fillInferredFields(
  fields: Array<{ element: FieldMatch['element']; label: string }>,
  profile: Profile,
  options: { aiOptionFallback?: typeof aiOptionFallback } = {}
): Promise<{ filled: Array<{ label: string; answer: string }>; aiChoices: FillResult['aiChoices'] }> {
  aiOptionFallback = options.aiOptionFallback;
  const filled: Array<{ label: string; answer: string }> = [];
  const aiChoices: FillResult['aiChoices'] = [];

  for (const field of fields) {
    const answer = inferAnswer(field.label, profile);
    if (!answer) continue;
    lastAiChoice = undefined;
    if (await fillTextField(field.element, answer)) {
      filled.push({ label: field.label, answer });
      if (lastAiChoice) aiChoices.push({ label: field.label, answer: lastAiChoice });
    }
    lastAiChoice = undefined;
  }

  return { filled, aiChoices };
}

/** Fills radio-button groups matched by matchRadioGroups. */
export function fillRadioGroups(groups: RadioGroupMatch[], profile: Profile): FillResult {
  let filledCount = 0;
  const skippedLabels: string[] = [];

  for (const group of groups) {
    const kind = getValueKind(group.path);
    let didFill = false;

    lastComboboxReason = undefined;
    if (kind === 'boolean') {
      const value = resolveBoolean(profile, group.path);
      if (value !== null) {
        didFill = setRadioGroupByPredicate(group.elements, (t) => matchesBooleanAnswer(t, value));
      }
    } else if (kind === 'preference') {
      const preferences = resolvePreferenceList(profile, group.path).map(normalizeText);
      for (const pref of preferences) {
        didFill = setRadioGroupByPredicate(group.elements, (t) => t === pref || t.includes(pref));
        if (didFill) break;
      }
    } else {
      const text = resolveText(profile, group.path);
      if (text) {
        const target = normalizeText(text);
        didFill = setRadioGroupByPredicate(group.elements, (t) => t === target);
      }
    }

    if (didFill) filledCount += 1;
    else skippedLabels.push(group.label);
  }

  // Radio groups are native elements matched deterministically — the model is
  // never consulted for them.
  return { filledCount, skippedCount: skippedLabels.length, skippedLabels, aiChoices: [] };
}
