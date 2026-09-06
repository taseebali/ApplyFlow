import { ChevronIcon } from './icons';

interface ActionRowProps {
  icon: React.ReactNode;
  title: string;
  /** The one-line state of this action right now — "11 fields matched". */
  description: string;
  tint: 'blue' | 'green' | 'amber' | 'neutral';
  onClick: () => void;
  disabled?: boolean;
  /** Pills shown at the right-hand end of the row. */
  children?: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/**
 * One action, as a row in a list.
 *
 * Replaces the card this used to be. Four cards each rendered their results
 * beneath themselves, so opening the first pushed the other three off the
 * screen and there was no way to see the state of the application as a whole.
 * A row carries its status on the right, which means five rows fit above the
 * fold and the whole picture reads at a glance.
 *
 * Same structure as before for the same reason: the row is a container, not a
 * button, because it holds two actions. A `<button>` inside a `<button>` is
 * invalid and screen readers handle it unpredictably.
 */
export function ActionRow({
  icon,
  title,
  description,
  tint,
  onClick,
  disabled,
  children,
  collapsed,
  onToggleCollapse,
}: ActionRowProps) {
  const collapsible = typeof onToggleCollapse === 'function';

  return (
    <div className={`action-row ${disabled ? 'action-row-disabled' : ''}`}>
      <button type="button" className="action-row-main" onClick={onClick} disabled={disabled}>
        <span className={`action-row-icon tint-${tint}`}>{icon}</span>
        <span className="action-row-body">
          <span className="action-row-title">{title}</span>
          <span className="action-row-desc">{description}</span>
        </span>
        {/* Status lives at the end of the row, so a column of rows can be
            scanned down its right edge. */}
        {children && <span className="action-row-status">{children}</span>}
      </button>

      {collapsible ? (
        <button
          type="button"
          className="action-row-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          onClick={onToggleCollapse}
        >
          <ChevronIcon className={collapsed ? '' : 'chevron-open'} />
        </button>
      ) : (
        <span className="action-row-toggle" aria-hidden="true">
          <ChevronIcon />
        </span>
      )}
    </div>
  );
}
