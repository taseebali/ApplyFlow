/**
 * A score with a verdict, rather than a bare number in a pill.
 *
 * `40/100` told the user nothing: there was no way to know whether that was
 * bad, and no reason given. The ring carries the value, the word carries the
 * interpretation, and the caller supplies what is behind it.
 */

export type Verdict = 'strong' | 'fair' | 'weak';

export function verdictFor(score: number): Verdict {
  if (score >= 80) return 'strong';
  if (score >= 55) return 'fair';
  return 'weak';
}

const WORDS: Record<Verdict, string> = {
  strong: 'Strong match',
  fair: 'Fair match',
  weak: 'Weak match',
};

export function ScoreRing({ score, detail }: { score: number; detail: string }) {
  const verdict = verdictFor(score);
  const clamped = Math.max(0, Math.min(100, score));
  // r = 17 → circumference 106.8. Dash length is the fraction of it filled.
  const filled = (clamped / 100) * 106.8;

  return (
    <div className="score">
      <svg
        className={`score-ring score-${verdict}`}
        viewBox="0 0 42 42"
        role="img"
        aria-label={`${clamped} out of 100 — ${WORDS[verdict].toLowerCase()}`}
      >
        <circle className="score-track" cx="21" cy="21" r="17" fill="none" strokeWidth="5" />
        <circle
          className="score-value"
          cx="21"
          cy="21"
          r="17"
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${filled} 106.8`}
          transform="rotate(-90 21 21)"
        />
        <text x="21" y="24.5" textAnchor="middle" fontSize="12" fontWeight="700">
          {clamped}
        </text>
      </svg>
      <span className="score-text">
        <span className="score-verdict">{WORDS[verdict]}</span>
        <span className="hint">{detail}</span>
      </span>
    </div>
  );
}

/**
 * What the posting asks for, and whether you have it.
 *
 * Replaces a sentence — "This posting asks for kubernetes, terraform and
 * nothing in your profile mentions them" — that said the same thing but had to
 * be read rather than scanned.
 */
export function KeywordChips({ covered, missing }: { covered: string[]; missing: string[] }) {
  if (covered.length === 0 && missing.length === 0) return null;

  return (
    <div className="chips">
      {covered.map((term) => (
        <span key={term} className="chip">
          {term}
        </span>
      ))}
      {missing.map((term) => (
        <span key={term} className="chip chip-missing">
          {term}
        </span>
      ))}
    </div>
  );
}
