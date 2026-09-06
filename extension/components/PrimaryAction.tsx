import { createContext, useContext, useEffect, useState } from 'react';

/**
 * The one thing to do on this screen, pinned to the bottom edge.
 *
 * Filling is what the panel is for, and it used to scroll away the moment any
 * card opened its results underneath it. The action stays where it is;
 * whichever section owns the logic publishes it here rather than the footer
 * reaching into that section's state.
 */

export interface PrimaryAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Shown instead of the label while the action is running. */
  busyLabel?: string;
  busy?: boolean;
}

const Context = createContext<{
  action: PrimaryAction | null;
  publish: (action: PrimaryAction | null) => void;
}>({ action: null, publish: () => {} });

export function PrimaryActionProvider({ children }: { children: React.ReactNode }) {
  const [action, setAction] = useState<PrimaryAction | null>(null);
  return <Context.Provider value={{ action, publish: setAction }}>{children}</Context.Provider>;
}

/**
 * Publishes this section's action as the panel's primary one.
 *
 * `deps` is what the action closes over — without it the footer would keep
 * calling the first render's handler, which is the classic stale-closure bug
 * this pattern invites.
 */
export function usePrimaryAction(action: PrimaryAction | null, deps: unknown[]): void {
  const { publish } = useContext(Context);

  useEffect(() => {
    publish(action);
    return () => publish(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function PrimaryActionBar() {
  const { action } = useContext(Context);
  if (!action) return null;

  return (
    <div className="primary-action">
      <button
        type="button"
        className="btn btn-primary"
        disabled={action.disabled || action.busy}
        onClick={action.onClick}
      >
        {action.busy ? (action.busyLabel ?? 'Working…') : action.label}
      </button>
    </div>
  );
}
