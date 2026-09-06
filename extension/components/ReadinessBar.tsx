import { useEffect, useState } from 'react';
import { assessReadiness, type Readiness } from '@/lib/readiness';
import { getBank, missingSources } from '@/lib/bullet-bank';
import { sourcesFrom } from '@/lib/bank-generation';
import { getDocumentsFolderHandle } from '@/lib/document-store';
import { getSettings } from '@/lib/settings';
import { getProfile } from '@/lib/storage';
import type { GroupId } from '@/lib/setup-groups';

/**
 * One line for whether this application can actually be sent.
 *
 * Every blocker names the control that fixes it and opens the group that holds
 * it. Before this the user found out mid-fill, from a card that refused, and
 * the link it offered opened the first settings tab whatever was wrong.
 */
/**
 * Whether this application can be sent, and what stands in the way.
 *
 * Shared rather than local so the sticky action can be gated by the same
 * assessment the user is reading, instead of a second opinion about it.
 */
export function useReadiness(): Readiness | null {
  const [state, setState] = useState<Readiness | null>(null);

  useEffect(() => {
    const refresh = async () => {
      const [profile, bank, settings, folder] = await Promise.all([
        getProfile(),
        getBank(),
        getSettings(),
        getDocumentsFolderHandle(),
      ]);
      const sources = sourcesFrom(profile);
      setState(
        assessReadiness({
          profile,
          totalSources: sources.length,
          uncoveredSources: missingSources(bank, sources.map((s) => s.id)).length,
          hasBank: Boolean(bank && bank.variants.length > 0),
          documentsFolderLinked: Boolean(folder),
          aiConfigured: Boolean(settings.llm.backend),
        })
      );
    };

    void refresh();
    browser.storage.local.onChanged.addListener(refresh);
    return () => browser.storage.local.onChanged.removeListener(refresh);
  }, []);

  return state;
}

export function ReadinessBar({ onOpen }: { onOpen: (group: GroupId, step?: string) => void }) {
  const state = useReadiness();

  if (!state) return null;

  if (state.blockers.length === 0) {
    return (
      <p className="readiness readiness-ok" role="status" aria-live="polite">
        <span aria-hidden="true">✓</span> Ready — {state.summary}
      </p>
    );
  }

  const count = state.blockers.length;

  return (
    <div className="readiness readiness-blocked" role="status" aria-live="polite">
      <p className="readiness-title">
        {state.ready
          ? `${count} thing${count === 1 ? '' : 's'} worth fixing`
          : `${count} thing${count === 1 ? '' : 's'} before you can fill this`}
      </p>
      <ul>
        {state.blockers.map((blocker) => (
          <li key={blocker.id}>
            <span>{blocker.label}</span>
            <button type="button" className="btn-plain" onClick={() => onOpen(blocker.target, blocker.step)}>
              {blocker.action}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
