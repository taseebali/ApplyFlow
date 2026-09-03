/**
 * Finds the faults that make a resume score badly, without asking a model
 * anything.
 *
 * This exists because a model-written resume scored 40/100 on an ATS scorer,
 * and the faults it named were all mechanical: five of seven bullets opened
 * with the same verb, almost nothing carried a number, and the vocabulary was
 * the generic register that resume training data is full of.
 *
 * None of that needs an LLM to detect, and detecting it in code rather than
 * asking a model to avoid it is the difference between a constraint and a
 * request. A prompt saying "vary your verbs" fails silently; this does not.
 *
 * Runs over the user's own bullets in Setup, and again as a gate on every
 * generated variant before it is allowed into the bank.
 */

export type FaultKind = 'verb-collision' | 'no-metric' | 'weak-opener' | 'cliche' | 'too-long' | 'passive';

export interface BulletFault {
  kind: FaultKind;
  /** Shown to the user, so it names the problem rather than the rule. */
  detail: string;
}

/** How much each fault costs, out of 100. Verb collision is the heaviest because it is the most visible to a human reader skimming a page. */
const PENALTY: Record<FaultKind, number> = {
  'verb-collision': 12,
  'weak-opener': 10,
  'no-metric': 8,
  cliche: 6,
  'too-long': 4,
  passive: 3,
};

/**
 * Openers that describe involvement rather than achievement. A bullet starting
 * this way has usually buried whatever the person actually did.
 */
const WEAK_OPENERS = [
  'responsible for',
  'worked on',
  'helped with',
  'helped to',
  'assisted with',
  'assisted in',
  'participated in',
  'involved in',
  'tasked with',
  'leveraged',
  'utilized',
  'utilised',
];

/** Phrases that appear on so many resumes they carry no information. */
const CLICHES = [
  'cross-functional',
  'cross functional',
  'fast-paced',
  'fast paced',
  'team player',
  'passionate about',
  'proven track record',
  'results-driven',
  'results driven',
  'detail-oriented',
  'detail oriented',
  'go-getter',
  'think outside the box',
  'wear many hats',
  'synergy',
  'best practices',
];

/** Beyond roughly two printed lines a bullet stops being skimmable. */
const MAX_LENGTH = 200;

/**
 * The first word, which is what a reader's eye lands on and what collides
 * across a section. Deliberately not stemmed: "Built" and "Building" are
 * treated as different openers, which is imprecise but never produces a
 * false collision — and a false collision would send someone rewriting a
 * bullet that was fine.
 */
export function openingVerb(text: string): string {
  const first = text.trim().replace(/^[•\-*\s]+/, '').split(/\s+/)[0] ?? '';
  return first.toLowerCase().replace(/[^a-z]/g, '');
}

export function hasMetric(text: string): boolean {
  // A digit anywhere. Catches "40%", "3 services", "10k users", "1.2s" — and
  // correctly misses "reduced latency significantly", which is the whole point.
  return /\d/.test(text);
}

/** Faults visible in one bullet on its own. Collisions need the whole section. */
export function scoreBullet(text: string): BulletFault[] {
  const faults: BulletFault[] = [];
  const trimmed = text.trim();
  if (!trimmed) return faults;

  const lower = trimmed.toLowerCase();

  const weak = WEAK_OPENERS.find((opener) => lower.startsWith(opener));
  if (weak) {
    faults.push({
      kind: 'weak-opener',
      detail: `Starts with "${weak}" — say what you did, not that you were involved.`,
    });
  }

  if (!hasMetric(trimmed)) {
    faults.push({ kind: 'no-metric', detail: 'No number. How many, how much faster, how large?' });
  }

  for (const cliche of CLICHES) {
    if (lower.includes(cliche)) {
      faults.push({ kind: 'cliche', detail: `"${cliche}" appears on most resumes and says nothing.` });
      break; // One is enough to make the point.
    }
  }

  if (trimmed.length > MAX_LENGTH) {
    faults.push({
      kind: 'too-long',
      detail: `${trimmed.length} characters — over about two lines, this stops being skimmed.`,
    });
  }

  // Crude on purpose, and weighted lightly to match: catching "was designed"
  // is useful, and the occasional false positive costs three points.
  if (/\b(was|were|been|being|is|are)\s+\w+(ed|en)\b/i.test(trimmed)) {
    faults.push({ kind: 'passive', detail: 'Reads as passive — name yourself as the one who did it.' });
  }

  return faults;
}

export interface SectionScore {
  /** Faults per bullet, index-aligned with the input. */
  perBullet: BulletFault[][];
  /** 0-100. Starts at 100 and pays for every fault found. */
  score: number;
  /** Every fault across the section, for a summary count. */
  all: BulletFault[];
}

/**
 * Scores a set of bullets that appear together — one role, or one project.
 *
 * Collisions can only be seen at this level: a bullet opening with "Built" is
 * fine, and the fifth one is not.
 */
export function scoreSection(bullets: string[]): SectionScore {
  const perBullet = bullets.map((text) => scoreBullet(text));

  // Every use of a verb after the first is a collision, so five "Built"
  // bullets score four faults rather than one.
  const seen = new Map<string, number>();
  bullets.forEach((text, index) => {
    const verb = openingVerb(text);
    if (!verb) return;
    const count = (seen.get(verb) ?? 0) + 1;
    seen.set(verb, count);
    if (count > 1) {
      perBullet[index]!.push({
        kind: 'verb-collision',
        detail: `The ${ordinal(count)} bullet starting with "${verb}" — vary the opening verb.`,
      });
    }
  });

  const all = perBullet.flat();
  const penalty = all.reduce((sum, fault) => sum + PENALTY[fault.kind], 0);

  return { perBullet, all, score: Math.max(0, 100 - penalty) };
}

function ordinal(n: number): string {
  if (n === 2) return 'second';
  if (n === 3) return 'third';
  if (n === 4) return 'fourth';
  if (n === 5) return 'fifth';
  return `${n}th`;
}

/** True when a bullet is good enough to enter the generated bank. */
export function isPublishable(text: string): boolean {
  // A missing metric is a reason to ask the user for one, not a reason to
  // throw away a correctly written sentence — the model cannot invent the
  // number. Everything else is the model's own fault and gets regenerated.
  return scoreBullet(text).every((fault) => fault.kind === 'no-metric');
}
