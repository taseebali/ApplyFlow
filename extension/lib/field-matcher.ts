import { SCHEMA_FIELDS } from './schema';
import { isOffLimits } from './field-visibility';

export type FillableElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface FieldMatch {
  element: FillableElement;
  path: string;
  confidence: number;
  /** Best-available human-readable label, for surfacing "these fields need attention" in the UI. */
  label: string;
}

export interface RadioGroupMatch {
  elements: HTMLInputElement[];
  path: string;
  confidence: number;
  label: string;
}

const CONFIDENCE_THRESHOLD = 0.6;

const SOURCE_WEIGHTS: Record<string, number> = {
  label: 1.0,
  ariaLabel: 0.95,
  placeholder: 0.8,
  name: 0.75,
  id: 0.7,
};

/**
 * Folds accents onto their base letters so a label written in German, French,
 * Spanish or Portuguese survives normalisation.
 *
 * Without this, the ASCII-only filter below turned "Verfügbar" into
 * "verf gbar" and "Straße" into "stra e" — so every non-English alias was
 * unmatchable no matter how it was spelled. NFD splits a letter from its
 * accent; the range strips the accents that fall out. ß has no decomposition,
 * so it is handled explicitly.
 */
function foldAccents(text: string): string {
  // ̀-ͯ is the combining-diacritic block NFD splits accents into.
  // Written escaped because the literal characters are invisible in source.
  return text.replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeText(text: string): string {
  return foldAccents(text)
    .toLowerCase()
    .replace(/[_\-.]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether the label contains the alias as a *word*, for single-word aliases.
 *
 * A plain substring test lets short aliases match inside longer words: the
 * German alias "ort" (city) matched "imp**ort**ant" in a long accessibility
 * question, claiming a field that should have gone to drafting. "cv", "plz",
 * "zip" and "sex" all have the same problem. Multi-word aliases are specific
 * enough that a substring test is safe, and keeping it preserves matches like
 * "first name" inside "legal first name".
 */
function containsAlias(text: string, alias: string): boolean {
  if (alias.includes(' ')) return text.includes(alias);
  return (
    text === alias ||
    text.startsWith(`${alias} `) ||
    text.endsWith(` ${alias}`) ||
    text.includes(` ${alias} `)
  );
}

function scoreAgainstAlias(text: string, alias: string): number {
  if (!text) return 0;
  if (text === alias) return 1;

  // Scaled by how much of the label the alias actually accounts for. A flat
  // score here made "Preferred First Name" match the alias "name" as strongly
  // as "first name", and the more generic field won purely on list order.
  if (containsAlias(text, alias)) return 0.6 + 0.35 * (alias.length / text.length);
  if (alias.includes(text)) return 0.6 + 0.35 * (text.length / alias.length);

  const textTokens = new Set(text.split(' '));
  const aliasTokens = new Set(alias.split(' '));
  const intersection = [...textTokens].filter((t) => aliasTokens.has(t));
  const union = new Set([...textTokens, ...aliasTokens]);
  if (union.size === 0) return 0;
  return intersection.length / union.size;
}

function getLabelText(el: FillableElement): string {
  if (el.labels && el.labels.length > 0) {
    return Array.from(el.labels)
      .map((l) => l.textContent ?? '')
      .join(' ');
  }
  // Fall back to a wrapping <label> that has no `for` attribute.
  const wrappingLabel = el.closest('label');
  if (wrappingLabel) return wrappingLabel.textContent ?? '';

  // Some forms point `for` at the field's *name* rather than its id, which the
  // browser does not treat as an association at all — so `el.labels` is empty
  // and the field looks unlabelled. Ashby does this on its yes/no questions.
  const name = el.getAttribute('name');
  if (name) {
    // Escaped by hand rather than with CSS.escape, which is not defined in
    // every environment this runs in. Quotes and backslashes are all that can
    // break out of an attribute selector.
    const safe = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const byName = el.ownerDocument.querySelector(`label[for="${safe}"]`);
    if (byName?.textContent && !byName.contains(el)) return byName.textContent;
  }

  return '';
}

/**
 * A stable identifier for one field on one site, used to remember a mapping
 * the user taught us. Deliberately built from attributes that survive a
 * reload — never a DOM index, which shifts the moment the page renders
 * differently.
 */
export function fieldSignature(el: FillableElement): string {
  const name = el.getAttribute('name')?.trim();
  if (name) return `name:${name}`;
  if (el.id) return `id:${el.id}`;
  const label = normalizeText(getDisplayLabel(el));
  return label ? `label:${label}` : `type:${(el as HTMLInputElement).type ?? el.tagName}`;
}

/**
 * A label phrased as a yes/no question. Such a field wants an answer, never a
 * value copied out of the profile — filling "Are you enrolled at a
 * university?" with the name of a university is the failure this prevents.
 */
export function isYesNoQuestion(label: string): boolean {
  return /^\s*(are|do|did|does|have|has|can|could|will|would|is|was)\s+you?\b/i.test(label);
}

/** Best-available raw (non-normalized) label text for display purposes. */
export function getDisplayLabel(el: FillableElement): string {
  const label = getLabelText(el).trim();
  if (label) return label;
  const ariaLabel = el.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;
  const placeholder = (el as HTMLInputElement).placeholder?.trim();
  if (placeholder) return placeholder;
  const name = el.getAttribute('name')?.trim();
  if (name) return name;
  return el.id || 'field';
}

function getCandidates(el: FillableElement): Array<{ source: string; text: string }> {
  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  const ariaLabelledByText = ariaLabelledBy
    ? ariaLabelledBy
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
    : '';

  return [
    { source: 'label', text: getLabelText(el) },
    { source: 'ariaLabel', text: el.getAttribute('aria-label') ?? ariaLabelledByText },
    { source: 'placeholder', text: (el as HTMLInputElement).placeholder ?? '' },
    { source: 'name', text: el.getAttribute('name') ?? '' },
    { source: 'id', text: el.id ?? '' },
  ]
    .map((c) => ({ source: c.source, text: normalizeText(c.text) }))
    .filter((c) => c.text.length > 0);
}

/** Every element on the page we could write a profile value into. */
function fillableElements(root: ParentNode): FillableElement[] {
  return Array.from(root.querySelectorAll<FillableElement>('input, select, textarea')).filter((el) => {
    // A field the user cannot see is either a bot check or a honeypot, and
    // filling a honeypot gets the whole application discarded silently. See
    // lib/field-visibility.ts.
    if (isOffLimits(el)) return false;

    if (el instanceof HTMLInputElement) {
      // Radios are matched as groups (see matchRadioGroups) since a single
      // radio's own label is just its option text ("Yes"), not the question.
      const skipTypes = ['hidden', 'submit', 'button', 'reset', 'image', 'file', 'radio'];
      return !skipTypes.includes(el.type);
    }
    return true;
  });
}

export interface UnrecognizedField {
  label: string;
  signature: string;
}

/**
 * Fields we could fill but could not identify. These are what the user can
 * teach us — distinct from a field we recognised but had no data for.
 */
/** Same as `findUnrecognizedFields`, but keeps the elements so they can be filled. */
export function findUnrecognizedElements(
  root: ParentNode = document,
  overrides: Record<string, string> = {}
): Array<UnrecognizedField & { element: FillableElement }> {
  const recognized = new Set(matchFields(root, overrides).map((m) => m.element));
  const seen = new Set<string>();
  const fields: Array<UnrecognizedField & { element: FillableElement }> = [];

  for (const element of fillableElements(root)) {
    if (recognized.has(element)) continue;
    const signature = fieldSignature(element);
    if (seen.has(signature)) continue;
    seen.add(signature);
    fields.push({ element, label: getDisplayLabel(element), signature });
  }

  return fields;
}

export function findUnrecognizedFields(
  root: ParentNode = document,
  overrides: Record<string, string> = {}
): UnrecognizedField[] {
  const recognized = new Set(matchFields(root, overrides).map((m) => m.element));
  const seen = new Set<string>();
  const fields: UnrecognizedField[] = [];

  for (const element of fillableElements(root)) {
    if (recognized.has(element)) continue;
    const signature = fieldSignature(element);
    // One row per distinct field; repeated signatures are the same question.
    if (seen.has(signature)) continue;
    seen.add(signature);
    fields.push({ label: getDisplayLabel(element), signature });
  }

  return fields;
}

/**
 * Matches every fillable form element on the page to a Profile schema field.
 * `overrides` are mappings the user taught us for this site; they are exact
 * by definition, so they win over any heuristic score.
 */
export function matchFields(
  root: ParentNode = document,
  overrides: Record<string, string> = {}
): FieldMatch[] {
  const elements = fillableElements(root);

  const matches: FieldMatch[] = [];

  for (const element of elements) {
    const taught = overrides[fieldSignature(element)];
    if (taught) {
      matches.push({ element, path: taught, confidence: 1, label: getDisplayLabel(element) });
      continue;
    }

    // "Are you currently enrolled at a German university?" wants yes or no,
    // but contains "university" and so matches the school-name field. A
    // yes/no question can only ever be answered by a yes/no field.
    const wantsYesNo = isYesNoQuestion(getDisplayLabel(element));

    const candidates = getCandidates(element);
    let bestPath: string | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const weight = SOURCE_WEIGHTS[candidate.source] ?? 0.5;
      for (const field of SCHEMA_FIELDS) {
        if (wantsYesNo && field.valueKind !== 'boolean') continue;
        for (const alias of field.aliases) {
          const score = scoreAgainstAlias(candidate.text, alias) * weight;
          if (score > bestScore) {
            bestScore = score;
            bestPath = field.path;
          }
        }
      }
    }

    if (bestPath && bestScore >= CONFIDENCE_THRESHOLD) {
      matches.push({ element, path: bestPath, confidence: bestScore, label: getDisplayLabel(element) });
    }
  }

  return matches;
}

export interface FileInputMatch {
  element: HTMLInputElement;
  kind: 'resume' | 'coverLetter' | 'additional';
}

const FILE_INPUT_ALIASES: Record<FileInputMatch['kind'], string[]> = {
  resume: ['resume', 'cv', 'curriculum vitae', 'lebenslauf'],
  coverLetter: [
    'cover letter',
    'coverletter',
    'motivation letter',
    'letter of motivation',
    'anschreiben',
    'motivationsschreiben',
  ],
  // A catch-all upload field many ATSs use instead of (or alongside) dedicated
  // resume/cover-letter fields — the fallback target when no dedicated field exists.
  additional: [
    'additional documents',
    'additional document',
    'supporting documents',
    'supporting document',
    'other documents',
    'other document',
    'attachments',
    'weitere dokumente',
    'sonstige unterlagen',
    'zusätzliche dokumente',
    'anhänge',
  ],
};

/** Matches file-upload inputs on the page to "resume", "coverLetter", or a generic "additional" fallback field. */
export function matchFileInputs(root: ParentNode = document): FileInputMatch[] {
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  const matches: FileInputMatch[] = [];

  for (const element of inputs) {
    const candidates = getCandidates(element);
    let bestKind: FileInputMatch['kind'] | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const weight = SOURCE_WEIGHTS[candidate.source] ?? 0.5;
      for (const kind of Object.keys(FILE_INPUT_ALIASES) as Array<FileInputMatch['kind']>) {
        for (const alias of FILE_INPUT_ALIASES[kind]) {
          const score = scoreAgainstAlias(candidate.text, alias) * weight;
          if (score > bestScore) {
            bestScore = score;
            bestKind = kind;
          }
        }
      }
    }

    if (bestKind && bestScore >= CONFIDENCE_THRESHOLD) {
      matches.push({ element, kind: bestKind });
    }
  }

  return matches;
}

/** The visible option text for a single radio button, e.g. "Yes". */
export function getRadioOptionLabel(radio: HTMLInputElement): string {
  return getLabelText(radio);
}

/** The question a radio group is asking, from its <fieldset><legend> or ARIA group labelling. */
export function getRadioGroupQuestionText(firstRadio: HTMLInputElement): string {
  const fieldset = firstRadio.closest('fieldset');
  const legend = fieldset?.querySelector('legend');
  if (legend?.textContent) return legend.textContent;

  // A fieldset whose question is a <label> or heading rather than a <legend>.
  // Ashby writes exactly this, and the group was skipped entirely because the
  // question text was nowhere our lookup was willing to look.
  if (fieldset) {
    const heading = fieldset.querySelector('label, h1, h2, h3, h4, h5, h6');
    // Must be the group's own question, not one option's label.
    if (heading?.textContent && !heading.contains(firstRadio)) return heading.textContent;
  }

  const group = firstRadio.closest('[role="radiogroup"], [role="group"]');
  if (group) {
    const labelledBy = group.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      if (text.trim()) return text;
    }
    const ariaLabel = group.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
  }

  return '';
}

/** Groups radio buttons by `name` and matches each group's question to a Profile schema field. */
export function matchRadioGroups(root: ParentNode = document): RadioGroupMatch[] {
  const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  const groups = new Map<string, HTMLInputElement[]>();
  for (const radio of radios) {
    if (!radio.name) continue;
    const list = groups.get(radio.name) ?? [];
    list.push(radio);
    groups.set(radio.name, list);
  }

  const matches: RadioGroupMatch[] = [];

  for (const elements of groups.values()) {
    const [firstRadio] = elements;
    if (elements.length < 2 || !firstRadio) continue;
    const questionText = normalizeText(getRadioGroupQuestionText(firstRadio));
    if (!questionText) continue;

    let bestPath: string | null = null;
    let bestScore = 0;
    for (const field of SCHEMA_FIELDS) {
      for (const alias of field.aliases) {
        const score = scoreAgainstAlias(questionText, alias);
        if (score > bestScore) {
          bestScore = score;
          bestPath = field.path;
        }
      }
    }

    if (bestPath && bestScore >= CONFIDENCE_THRESHOLD) {
      matches.push({
        elements,
        path: bestPath,
        confidence: bestScore,
        label: getRadioGroupQuestionText(firstRadio).trim() || 'field',
      });
    }
  }

  return matches;
}
