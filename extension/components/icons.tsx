interface IconProps {
  className?: string;
}

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function FillIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 6h10M4 12h16M4 18h7" />
      <path d="M17 15l3 3-3 3" />
    </Svg>
  );
}

export function AttachIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M16 7.5V16a4 4 0 0 1-8 0V6a2.5 2.5 0 0 1 5 0v9.5a1 1 0 0 1-2 0V8" />
    </Svg>
  );
}

export function TrackerIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M9 9.5v10M15 9.5v10" />
    </Svg>
  );
}

export function DraftIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3.5l1.6 4.3 4.4 1.7-4.4 1.7L12 15.5l-1.6-4.3L6 9.5l4.4-1.7z" />
      <path d="M18 15.5l.8 2.1 2.2.9-2.2.9-.8 2.1-.8-2.1-2.2-.9 2.2-.9z" />
    </Svg>
  );
}

export function GearIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3" />
    </Svg>
  );
}

export function BackIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M15 5l-7 7 7 7" />
    </Svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}
