import { hasMetric, openingVerb } from './bullet-quality';
import { StorageFullError } from './storage';

/**
 * Pre-generated ways of describing the same work.
 *
 * Tailoring per application would re-roll quality every time and repeat the
 * same faults, because each run has no memory of the last. Generating once,
 * checking once and repairing once means the expensive work happens ahead of
 * any application, and applying becomes ranking.
 *
 * Nothing here is a document. The bank is raw material: sentences that get
 * selected, ordered and assembled into a resume at application time.
 */

/**
 * Ways of framing one piece of work. Deliberately not job titles — titles have
 * an unbounded tail and no answer for one we have never seen, whereas any role
 * can be expressed as a preferred mix of these.
 */
export const ANGLES = ['technical', 'scale', 'impact', 'ownership', 'collaboration', 'delivery'] as const;
export type Angle = (typeof ANGLES)[number];

export interface BulletVariant {
  id: string;
  /** The role or project this reframes. */
  sourceId: string;
  angle: Angle;
  /**
   * The family this framing leans towards, when it leans at all. A preference
   * for selection, never a key — a posting whose family has no variants is
   * still served from the angle mix.
   */
  domainHint: string | null;
  text: string;
  /** Derived, never set by hand: selection enforces verb variety on it. */
  openingVerb: string;
  /** Derived: content words, for the shortlist that runs before the model. */
  terms: string[];
  /** Derived. */
  hasMetric: boolean;
}

export interface BulletBank {
  variants: BulletVariant[];
  generatedAt: number;
  /** Which model wrote it, so an inconsistent bank can be traced. */
  model: string;
  /** The families generation was told to target. */
  families: string[];
}

/**
 * Words carrying no signal for matching a bullet to a posting. Kept small on
 * purpose — an over-eager stoplist throws away real terms like "test" or "data".
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from',
  'as', 'into', 'over', 'that', 'this', 'it', 'its', 'was', 'were', 'is', 'are', 'be', 'been',
  'has', 'have', 'had', 'not', 'per', 'via', 'up', 'out', 'across', 'while', 'than', 'then',
  // Two-letter words carry no signal, but plenty of two-letter *technologies*
  // do — C#, Go, R, CI, QA, UX, ML. So the list does the filtering rather than
  // a length cutoff, which was silently dropping all of them.
  'we', 'my', 'i', 'so', 'if', 'do', 'no', 'us', 'am', 'he', 'me',
]);

/** Lowercased content words, deduplicated. Cheap enough to precompute per variant. */
export function contentTerms(text: string): string[] {
  const words = text
    .toLowerCase()
    // `/` splits rather than joins, so "CI/CD" becomes two usable terms.
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[-.]+|[-.]+$/g, ''))
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

/**
 * Builds a variant with its derived fields computed rather than supplied.
 * Selection depends on `openingVerb` and `terms` being right; letting a caller
 * pass them is how they drift out of step with the text.
 */
export function makeVariant(input: {
  sourceId: string;
  angle: Angle;
  text: string;
  domainHint?: string | null;
}): BulletVariant {
  const text = input.text.trim();
  return {
    id: crypto.randomUUID(),
    sourceId: input.sourceId,
    angle: input.angle,
    domainHint: input.domainHint ?? null,
    text,
    openingVerb: openingVerb(text),
    terms: contentTerms(text),
    hasMetric: hasMetric(text),
  };
}

const BANK_KEY = 'bullet-bank';

export async function getBank(): Promise<BulletBank | null> {
  const stored = await browser.storage.local.get(BANK_KEY);
  const bank = stored[BANK_KEY] as BulletBank | undefined;
  if (!bank || !Array.isArray(bank.variants)) return null;
  return bank;
}

export async function setBank(bank: BulletBank): Promise<void> {
  try {
    await browser.storage.local.set({ [BANK_KEY]: bank });
  } catch (err) {
    throw new StorageFullError(
      'Could not save the generated bank — this browser’s extension storage is full. Remove some earlier versions under Setup → Earlier versions, then try again.',
      { cause: err }
    );
  }
}

export async function clearBank(): Promise<void> {
  await browser.storage.local.remove(BANK_KEY);
}

/** Variants for one role or project, so a regenerated item can replace only its own. */
export function variantsFor(bank: BulletBank | null, sourceId: string): BulletVariant[] {
  return (bank?.variants ?? []).filter((v) => v.sourceId === sourceId);
}

/**
 * Replaces one source item's variants, leaving every other item untouched.
 * Regenerating a single project must not cost the rest of the bank.
 */
export function replaceSource(bank: BulletBank, sourceId: string, variants: BulletVariant[]): BulletBank {
  return { ...bank, variants: [...bank.variants.filter((v) => v.sourceId !== sourceId), ...variants] };
}

/** How old the bank is, in whole days. A stale bank describes work that has moved on. */
export function ageInDays(bank: BulletBank, now = Date.now()): number {
  return Math.floor((now - bank.generatedAt) / 86_400_000);
}

/**
 * Whether the bank still covers the profile it was generated from. A new role
 * or project is invisible to tailoring until the bank knows about it, and that
 * failure is silent otherwise.
 */
export function missingSources(bank: BulletBank | null, sourceIds: string[]): string[] {
  const covered = new Set((bank?.variants ?? []).map((v) => v.sourceId));
  return sourceIds.filter((id) => !covered.has(id));
}

/**
 * Replaces one variant's wording with the user's own edit.
 *
 * This is how the bank improves without anyone maintaining it as a chore. A
 * resume gets edited before it is sent anyway; keeping that edit means every
 * future application inherits it, and the alternative — a separate curation
 * screen nobody opens — does not survive contact with real use.
 *
 * The derived fields are recomputed, so an edit that changes the opening verb
 * is respected by the next selection rather than quietly ignored.
 */
export function reviseVariant(bank: BulletBank, variantId: string, text: string): BulletBank {
  return {
    ...bank,
    variants: bank.variants.map((variant) =>
      variant.id === variantId
        ? {
            ...variant,
            ...makeVariant({
              sourceId: variant.sourceId,
              angle: variant.angle,
              text,
              domainHint: variant.domainHint,
            }),
            // The id is the handle a selection already holds; changing it would
            // orphan the bullet mid-review.
            id: variant.id,
          }
        : variant
    ),
  };
}
