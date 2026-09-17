/**
 * The small pieces every view draws the same way.
 *
 * A status looks identical in a table cell, on a board card and in the detail
 * panel, which is the only reason the three views can be read as one thing.
 */
import type { ApplicationStatus, Priority } from './bridge';
export { fromDateInput, toDateInput } from './records';

/**
 * Status to state colour.
 *
 * The four state colours are already spoken for by the design system, so the
 * mapping is a reading of what each status means rather than a free choice:
 * an offer is good, a rejection is bad, an interview is the extension's own
 * accent because it is the outcome the tool is for, and everything earlier is
 * simply waiting.
 */
const STATUS_TONE: Record<ApplicationStatus, string> = {
  applied: 'off',
  replied: 'wait',
  interview: 'ai',
  offer: 'ok',
  rejected: 'bad',
};

export function StatusTag({ status }: { status: ApplicationStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <span className={`tag tag-${tone}`}>
      <span className={`dot dot-${tone}`} style={{ marginRight: 5 }} aria-hidden="true" />
      {status}
    </span>
  );
}

const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'No priority',
  low: 'Low priority',
  medium: 'Medium priority',
  high: 'High priority',
};

/**
 * Priority as filled bars rather than a colour.
 *
 * Colour is already carrying status everywhere on this page, and a second
 * colour scale would make both harder to read. Three bars are countable at a
 * glance and survive being printed, screenshotted or read by someone who
 * cannot separate the hues.
 */
export function PriorityBars({ priority }: { priority: Priority }) {
  const filled = { none: 0, low: 1, medium: 2, high: 3 }[priority];
  if (filled === 0) return <span className="cell-muted">—</span>;

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 11 }}
      title={PRIORITY_LABEL[priority]}
    >
      <span className="sr-only">{PRIORITY_LABEL[priority]}</span>
      {[5, 8, 11].map((height, i) => (
        <span
          key={height}
          aria-hidden="true"
          style={{
            width: 3,
            height,
            borderRadius: 1,
            background: i < filled ? 'var(--text)' : 'var(--border)',
          }}
        />
      ))}
    </span>
  );
}

export function TagChip({ children }: { children: React.ReactNode }) {
  return <span className="tag-chip" style={{ paddingRight: 8 }}>{children}</span>;
}

/** Match score as a bar. Its colour is the verdict the panel already uses. */
export function Meter({ score }: { score: number | null }) {
  if (score === null) return <span className="cell-muted">Not scored</span>;
  const tone = score >= 70 ? 'ok' : score >= 45 ? 'wait' : 'bad';

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <span className="meter" role="img" aria-label={`Match ${score} out of 100`}>
        <span className={`meter-fill meter-fill-${tone}`} style={{ width: `${score}%` }} />
      </span>
      <span className="cell-num" aria-hidden="true">{score}</span>
    </span>
  );
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * A date said the way a person would say it, with the real one underneath.
 *
 * "3 days ago" is what makes a list of applications scannable; the exact date
 * is what makes it checkable, so the `title` and `dateTime` keep it.
 */
export function RelativeDate({ at, now = Date.now() }: { at: number; now?: number }) {
  const days = Math.round((now - at) / DAY);
  const iso = new Date(at).toISOString();
  const full = new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  let label: string;
  if (days === 0) label = 'Today';
  else if (days === 1) label = 'Yesterday';
  else if (days === -1) label = 'Tomorrow';
  else if (days < -1) label = `In ${-days} days`;
  else if (days < 30) label = `${days} days ago`;
  else if (days < 365) {
    const months = Math.round(days / 30);
    label = months === 1 ? 'A month ago' : `${months} months ago`;
  }
  else label = full;

  return (
    <time dateTime={iso} title={full}>
      {label}
    </time>
  );
}

/** An overdue action is the one thing on this page that should look wrong. */
export function DueDate({ at, now = Date.now() }: { at: number | null; now?: number }) {
  if (at === null) return <span className="cell-muted">—</span>;
  return (
    <span style={{ color: at < now ? 'var(--bad)' : undefined }}>
      <RelativeDate at={at} now={now} />
    </span>
  );
}
