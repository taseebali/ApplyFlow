import { ChevronIcon } from './icons';

/**
 * One step of preparing an application.
 *
 * Replaces ActionRow, and the whole point of the replacement is what the row
 * is *not*: a button. ActionRow made its body a `<button>` whose `onClick`
 * differed per card — Tailor toggled open, Attach ran a folder search, Draft
 * spent model requests — and then rendered that action's results directly
 * underneath the same clickable strip. So reading what came back meant
 * clicking near the thing that produced it, and a stray click re-ran the work
 * and re-spent the budget. Two of the three rows did that.
 *
 * Here the row reports and the button acts, and they are different elements.
 * A step has exactly one place that starts anything: `action`. Everything
 * else — the title, the status, the detail below — can be read, selected and
 * clicked through with no consequence at all.
 */
export type StepTone = 'neutral' | 'ok' | 'wait' | 'bad' | 'ai';

export interface StepProps {
  /** Its position in the flow. Shown, because the order is the instruction. */
  index: number;
  title: string;
  /** Where this step stands right now, in one line. Never a call to action. */
  status: string;
  tone?: StepTone;
  /** The only thing here that does anything. */
  action?: React.ReactNode;
  /** Detail under the row: results, explanations, secondary controls. */
  children?: React.ReactNode;
  /** Omit to leave the detail always visible. */
  open?: boolean;
  onToggle?: () => void;
  /** Marks the step finished, which is worth seeing at a glance down a column. */
  done?: boolean;
}

export function Step({
  index,
  title,
  status,
  tone = 'neutral',
  action,
  children,
  open,
  onToggle,
  done,
}: StepProps) {
  const collapsible = typeof onToggle === 'function';
  const expanded = collapsible ? open !== false : true;

  return (
    <section className={`step${done ? ' step-done' : ''}`} aria-label={title}>
      <div className="step-head">
        <span className={`step-index${done ? ' step-index-done' : ''}`} aria-hidden="true">
          {done ? '✓' : index}
        </span>

        <div className="step-text">
          <h3 className="step-title">{title}</h3>
          {/* Live, because every result in this panel arrives asynchronously
              and used to change in place announced to nobody. */}
          <p className={`step-status step-status-${tone}`} role="status" aria-live="polite">
            {status}
          </p>
        </div>

        {action && <div className="step-action">{action}</div>}

        {collapsible && (
          <button
            type="button"
            className="step-toggle"
            aria-expanded={expanded}
            aria-label={expanded ? `Hide ${title} detail` : `Show ${title} detail`}
            onClick={onToggle}
          >
            <ChevronIcon className={expanded ? 'chevron-open' : ''} />
          </button>
        )}
      </div>

      {children && expanded && <div className="step-detail">{children}</div>}
    </section>
  );
}
