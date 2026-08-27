interface ActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  tint: 'blue' | 'green' | 'amber' | 'neutral';
  onClick: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

export function ActionCard({ icon, title, description, tint, onClick, disabled, children }: ActionCardProps) {
  return (
    <button type="button" className={`action-card tint-${tint}`} onClick={onClick} disabled={disabled}>
      <span className="action-card-icon">{icon}</span>
      <span className="action-card-body">
        <span className="action-card-title">{title}</span>
        <span className="action-card-desc">{description}</span>
        {children && <span className="action-card-result">{children}</span>}
      </span>
    </button>
  );
}
