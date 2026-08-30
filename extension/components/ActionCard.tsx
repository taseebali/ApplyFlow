import { ChevronIcon } from './icons';

interface ActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  tint: 'blue' | 'green' | 'amber' | 'neutral';
  onClick: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
  /**
   * When provided, the card grows a disclosure arrow that folds it — and
   * everything the section renders below it — out of the way. A panel with
   * four cards of results gets long, and scrolling back to the top should not
   * be the only way to reach the first one.
   */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/**
 * The card is a container rather than a button, because it holds two separate
 * actions: run the thing, and fold it away. A `<button>` inside a `<button>`
 * is invalid, and screen readers handle it unpredictably — so the primary
 * action and the disclosure arrow are siblings, and the container carries the
 * card's appearance.
 */
export function ActionCard({
  icon,
  title,
  description,
  tint,
  onClick,
  disabled,
  children,
  collapsed,
  onToggleCollapse,
}: ActionCardProps) {
  const collapsible = typeof onToggleCollapse === 'function';

  return (
    <div className={`action-card tint-${tint} ${disabled ? 'action-card-disabled' : ''}`}>
      <button type="button" className="action-card-main" onClick={onClick} disabled={disabled}>
        <span className="action-card-icon">{icon}</span>
        <span className="action-card-body">
          <span className="action-card-title">{title}</span>
          <span className="action-card-desc">{description}</span>
          {/* Results stay mounted while collapsed so nothing is recomputed or
              re-requested when the card is opened again. */}
          {children && !collapsed && <span className="action-card-result">{children}</span>}
        </span>
      </button>

      {collapsible && (
        <button
          type="button"
          className="action-card-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          onClick={onToggleCollapse}
        >
          <ChevronIcon className={collapsed ? '' : 'chevron-open'} />
        </button>
      )}
    </div>
  );
}
