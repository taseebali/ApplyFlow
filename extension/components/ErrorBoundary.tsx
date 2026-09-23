import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * What a thrown render error looks like instead of a blank panel.
 *
 * React unmounts the whole tree when a render throws and nothing catches it.
 * In a side panel that leaves an empty white rectangle with no controls at
 * all, and the only way out a person can find is reloading the extension from
 * chrome://extensions — which is exactly the "I have to restart it again and
 * again" this exists to end.
 *
 * It is deliberately not a silent recovery. The error is shown, because a
 * panel that quietly swallowed the reason would make the next report as hard
 * to act on as the last one.
 */
interface State {
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack says which screen broke, which the message alone
    // usually does not. Kept in state rather than only logged: a side panel's
    // console is several clicks away and most people will never open it.
    this.setState({ info: info.componentStack?.trim().split('\n').slice(0, 6).join('\n') ?? '' });
    console.error('ApplyFlow crashed while rendering', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <h2>Something in the panel broke</h2>
        <p className="hint">
          This is a bug in ApplyFlow, not in your profile — nothing has been lost. Dismissing this
          puts the panel back; if it keeps happening, the detail below is what to report.
        </p>

        <div className="actions mt-4">
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null, info: '' })}>
            Back to the panel
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void navigator.clipboard.writeText(`${error.message}\n\n${error.stack ?? ''}\n\n${info}`)}
          >
            Copy the detail
          </button>
        </div>

        <pre className="crash-detail">
          {error.message}
          {info && `\n${info}`}
        </pre>
      </div>
    );
  }
}
