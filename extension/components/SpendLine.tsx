import { useEffect, useState } from 'react';
import { formatSpend, getSpend, resetSpend, type Spend } from '@/lib/spend';

/**
 * What this extension has spent, under the actions that spend it.
 *
 * There was no such line, and no warning anywhere that a request could cost
 * anything at all. The first news of $0.20 was the OpenRouter dashboard, which
 * is the wrong place to find out. It stays quiet while everything is free and
 * says so plainly when it is not.
 */
export function SpendLine() {
  const [spend, setSpend] = useState<Spend | null>(null);

  useEffect(() => {
    const refresh = () => void getSpend().then(setSpend);
    refresh();
    // Recorded by the background of a run rather than by this component, so a
    // total that goes up while the panel is open has to be watched for.
    browser.storage.local.onChanged.addListener(refresh);
    return () => browser.storage.local.onChanged.removeListener(refresh);
  }, []);

  if (!spend || spend.requests === 0) return null;

  return (
    <p className={`spend-line ${spend.paid > 0 ? 'spend-line-paid' : ''}`}>
      <span>AI usage: {formatSpend(spend)}</span>
      {spend.paid > 0 && (
        <span className="pill pill-warning">
          {spend.paid} paid request{spend.paid === 1 ? '' : 's'}
        </span>
      )}
      <button
        type="button"
        className="btn-plain"
        onClick={() => void resetSpend().then(() => void getSpend().then(setSpend))}
      >
        Reset
      </button>
    </p>
  );
}
