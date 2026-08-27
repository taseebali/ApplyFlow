import { getRadioOptionLabel, normalizeText, type FieldMatch, type RadioGroupMatch } from './field-matcher';
import { SCHEMA_FIELDS, type Profile } from './schema';

export interface FillResult {
  filledCount: number;
  skippedCount: number;
  /** Labels of fields we recognized but couldn't fill (usually: no data for that field yet). */
  skippedLabels: string[];
}

const BOOLEAN_ANSWER_WORDS: Record<'true' | 'false', string[]> = {
  true: ['yes', 'y', 'true'],
  false: ['no', 'n', 'false'],
};

/**
 * Real-world options are often full sentences ("Yes, I would be willing to
 * move to Munich.") rather than a bare "Yes"/"No", so match on the leading
 * word instead of requiring the whole normalized text to equal it.
 */
function matchesBooleanAnswer(normalizedOptionText: string, value: boolean): boolean {
  const answers = BOOLEAN_ANSWER_WORDS[value ? 'true' : 'false'];
  const firstWord = normalizedOptionText.split(' ')[0] ?? '';
  return answers.includes(normalizedOptionText) || answers.includes(firstWord);
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

/** Text-valued fields, including ones derived rather than stored directly on Profile. */
function resolveText(profile: Profile, path: string): string | undefined {
  if (path === 'contact.fullName') {
    const full = `${profile.contact.firstName} ${profile.contact.lastName}`.trim();
    return full.length > 0 ? full : undefined;
  }
  if (path === 'logistics.hearAboutUs') {
    return profile.logistics.hearAboutUsPreferences[0];
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
export function setNativeValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
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

function fillTextField(el: FieldMatch['element'], text: string): boolean {
  if (el instanceof HTMLSelectElement) {
    const target = normalizeText(text);
    return setSelectByPredicate(el, (t) => t === target || t.includes(target));
  }
  setNativeValue(el, text);
  dispatchChange(el);
  return true;
}

function fillBooleanField(el: FieldMatch['element'], value: boolean): boolean {
  if (el instanceof HTMLSelectElement) {
    return setSelectByPredicate(el, (t) => matchesBooleanAnswer(t, value));
  }
  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    setNativeChecked(el, value);
    dispatchChange(el);
    return true;
  }
  return false;
}

function fillPreferenceField(el: FieldMatch['element'], profile: Profile, path: string): boolean {
  const preferences = resolvePreferenceList(profile, path).map(normalizeText);
  if (el instanceof HTMLSelectElement) {
    for (const pref of preferences) {
      if (setSelectByPredicate(el, (t) => t === pref || t.includes(pref))) return true;
    }
    return false;
  }
  const text = resolveText(profile, path);
  return text ? fillTextField(el, text) : false;
}

/** Fills text/select/textarea/checkbox fields matched by matchFields. */
export function fillFields(matches: FieldMatch[], profile: Profile): FillResult {
  let filledCount = 0;
  const skippedLabels: string[] = [];

  for (const match of matches) {
    const kind = getValueKind(match.path);
    let didFill = false;

    if (kind === 'boolean') {
      const value = resolveBoolean(profile, match.path);
      if (value !== null) didFill = fillBooleanField(match.element, value);
    } else if (kind === 'preference') {
      didFill = fillPreferenceField(match.element, profile, match.path);
    } else {
      const text = resolveText(profile, match.path);
      if (text) didFill = fillTextField(match.element, text);
    }

    if (didFill) filledCount += 1;
    else skippedLabels.push(match.label);
  }

  return { filledCount, skippedCount: skippedLabels.length, skippedLabels };
}

/** Fills radio-button groups matched by matchRadioGroups. */
export function fillRadioGroups(groups: RadioGroupMatch[], profile: Profile): FillResult {
  let filledCount = 0;
  const skippedLabels: string[] = [];

  for (const group of groups) {
    const kind = getValueKind(group.path);
    let didFill = false;

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

  return { filledCount, skippedCount: skippedLabels.length, skippedLabels };
}
