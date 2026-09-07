import {
  getDisplayLabel,
  getRadioGroupQuestionText,
  matchFields,
  matchRadioGroups,
  findUnrecognizedElements,
  type FillableElement,
} from './field-matcher';
import { inferAnswer } from './inference';
import { detectQuestions } from './question-detector';
import { isOffLimits } from './field-visibility';
import { matchOption, optionsFor } from './field-options';
import { plannedValue } from './filler';
import { shortName, statusFor, type PlannedField, type FormPlan } from './field-plan';
import type { Profile } from './schema';

/**
 * Reads the form and reports what would be written, touching nothing.
 *
 * Runs in the content script because it needs the live DOM. The value for each
 * field comes from `plannedValue`, the same resolver the fill uses, so
 * the plan cannot drift from what actually gets written - a plan that lies is
 * worse than no plan.
 */

/**
 * Which part of the form a field belongs to.
 *
 * Taken from the profile path where there is one, because the path already
 * encodes the grouping the user set up. Falling back to the fieldset or section
 * heading keeps unmatched fields near the fields they sit beside on the page.
 */
function groupOf(element: FillableElement, path: string | null): string {
  if (path) {
    const [head] = path.split('.');
    const named: Record<string, string> = {
      contact: 'Contact',
      links: 'Links',
      education: 'Education',
      workAuthorization: 'Work authorisation',
      logistics: 'Availability',
      languages: 'Languages',
    };
    return named[head ?? ''] ?? 'Profile';
  }

  const legend = element.closest('fieldset')?.querySelector('legend')?.textContent?.trim();
  if (legend) return legend.slice(0, 32);

  const heading = element
    .closest('section, [class*="section"], [class*="group"]')
    ?.querySelector('h1, h2, h3, h4')
    ?.textContent?.trim();
  return heading ? heading.slice(0, 32) : 'Other';
}

/** What a control currently holds, as text, whatever kind of control it is. */
function currentValue(element: FillableElement): string {
  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    return element.checked ? 'Yes' : '';
  }
  return element.value ?? '';
}

function isOptional(element: FillableElement): boolean {
  if (element.required || element.getAttribute('aria-required') === 'true') return false;
  const label = getDisplayLabel(element);
  return !/\*/.test(label);
}

/**
 * Every field on the page, in the order the page presents them.
 *
 * Order matters more than it looks: reading the panel top to bottom has to be
 * reading the form top to bottom, or the mirror stops being a mirror.
 */
export interface PlanResult {
  plan: FormPlan;
  /** The control behind each row, so a click in the panel can focus it. */
  elements: Map<string, FillableElement>;
}

export function planForm(
  profile: Profile,
  overrides: Record<string, string> = {},
  root: ParentNode = document
): FormPlan {
  return planWithElements(profile, overrides, root).plan;
}

export function planWithElements(
  profile: Profile,
  overrides: Record<string, string> = {},
  root: ParentNode = document
): PlanResult {
  const matches = matchFields(root, overrides);
  const byElement = new Map<FillableElement, string>(matches.map((m) => [m.element, m.path]));

  const questions = new Set(detectQuestions(root, profile).map((q) => q.element as FillableElement));
  const unknown = findUnrecognizedElements(root, overrides);

  // Radio groups and profile-inferred answers are written by the fill too, so
  // they belong in the plan. A diff that covers only some of what gets written
  // is worse than no diff, because it says it covers all of it.
  const radios = matchRadioGroups(root);
  for (const group of radios) {
    const first = group.elements[0];
    if (first && !byElement.has(first)) byElement.set(first, group.path);
  }
  const inferred = new Map<FillableElement, string>();
  for (const field of unknown) {
    const answer = inferAnswer(field.label, profile);
    if (answer) inferred.set(field.element, answer);
  }

  // One ordered pass over the document, so the plan is in page order rather
  // than in whichever order the matchers happened to run.
  const seen = new Set<FillableElement>();
  const ordered: FillableElement[] = [];
  const radioLeads = radios.map((g) => g.elements[0]).filter((el): el is HTMLInputElement => Boolean(el));
  for (const element of [
    ...matches.map((m) => m.element),
    ...radioLeads,
    ...questions,
    ...unknown.map((u) => u.element),
  ]) {
    if (!seen.has(element)) {
      seen.add(element);
      ordered.push(element);
    }
  }
  ordered.sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );

  const fields: PlannedField[] = [];
  const claimed = new Map<string, PlannedField>();
  const elements = new Map<string, FillableElement>();

  for (const [index, element] of ordered.entries()) {
    if (isOffLimits(element)) continue;

    const path = byElement.get(element) ?? null;
    const isRadio = element instanceof HTMLInputElement && element.type === 'radio';
    const label =
      (isRadio ? getRadioGroupQuestionText(element) : getDisplayLabel(element)) || element.name || 'Field';
    // A path resolves from the profile; an inferred answer is one the profile
    // settles without a path ("are you still studying?").
    const wanted = path ? plannedValue(profile, path) : inferred.get(element) ?? '';
    const current = currentValue(element);

    // What the control itself will accept. A guess that matches one of these
    // is the answer; one that matches none is a guess the form would reject,
    // so it is offered to the user as a choice instead of written blind.
    const options = optionsFor(element);
    const proposed = options.length > 0 ? matchOption(options, wanted) ?? '' : wanted;

    // The same path can match more than one control on a page. The fill writes
    // to all of them, so the row says how many rather than appearing repeatedly.
    const already = path ? claimed.get(path) : undefined;
    if (already) {
      already.count = (already.count ?? 1) + 1;
      continue;
    }

    const field: PlannedField = {
      id: `${index}-${element.name || element.id || label}`,
      label,
      name: shortName(label, path),
      path,
      current,
      proposed,
      status: statusFor({
        current,
        proposed,
        path,
        isQuestion: questions.has(element),
        optional: isOptional(element),
      }),
      group: groupOf(element, path),
      ...(options.length > 0 ? { options } : {}),
    };

    fields.push(field);
    elements.set(field.id, element);
    if (path) claimed.set(path, field);
  }

  return { plan: { fields, hostname: location.hostname }, elements };
}
