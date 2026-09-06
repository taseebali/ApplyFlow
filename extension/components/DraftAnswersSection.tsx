import { useEffect, useState } from 'react';
import { getActiveTabId } from '@/lib/active-tab';
import type { InsertAnswerMessage, InsertAnswerResponse } from '@/entrypoints/content';
import { getProfile, setProfile } from '@/lib/storage';
import type { StartDraftMessage } from '@/entrypoints/background';
import { patchTabState, type DraftEntry } from '@/lib/tab-state';
import { formatCost, summarizeRunCost } from '@/lib/run-cost';
import { getModels, type CatalogModel } from '@/lib/openrouter-catalog';
import { useTabState } from '@/components/useTabState';
import { ActionRow } from '@/components/ActionRow';
import { DraftIcon } from '@/components/icons';

// Serializes profile read-modify-write across concurrent "Save for reuse"
// clicks so a second save can't clobber the first (both would otherwise read
// the same stale profile and the second write would drop the first's entry).
let saveQueue: Promise<void> = Promise.resolve();

function queueProfileSave(question: string, answer: string): Promise<void> {
  const next = saveQueue.then(async () => {
    const profile = await getProfile();
    await setProfile({
      ...profile,
      customQA: [...profile.customQA, { id: crypto.randomUUID(), question, answer }],
    });
  });
  // Keep the chain alive even if this save fails, so later saves still run.
  saveQueue = next.catch(() => undefined);
  return next;
}

export function DraftAnswersCard({ onOpenSetup }: { onOpenSetup: OpenSetup }) {
  // Drafts live in the tab's own state, written by the background worker.
  // The panel is a view onto that run rather than its owner, so switching to
  // another application and back shows this one's answers — finished, or
  // still arriving.
  const { tabId, state: tabState, patch } = useTabState();
  // Which drafts are folded away. Purely a view preference, so it stays in the
  // component — the answers themselves live in tab state and are never
  // discarded or re-requested by collapsing.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [cardClosed, setCardClosed] = useState(false);
  const run = tabState.draft;
  const [starting, setStarting] = useState(false);

  const handleDraft = async () => {
    if (tabId === null) return;
    setStarting(true);
    try {
      const message: StartDraftMessage = { type: 'start-draft', tabId };
      const response = (await browser.runtime.sendMessage(message)) as { started?: boolean } | undefined;
      // The worker refuses a request that did not come from this panel. That
      // should be unreachable from here, so say so rather than sitting idle.
      if (!response?.started) {
        await patchTabState(tabId, {
          draft: { status: 'error', done: 0, total: 0, entries: [], message: 'Could not start drafting.' },
        });
      }
    } finally {
      setStarting(false);
    }
  };

  const updateDraft = (id: string, updates: Partial<DraftEntry>) => {
    if (!run) return;
    void patch({
      draft: { ...run, entries: run.entries.map((e) => (e.id === id ? { ...e, ...updates } : e)) },
    });
  };

  const handleInsert = async (id: string, text: string) => {
    updateDraft(id, { insertError: undefined });
    try {
      const tabId = await getActiveTabId();
      const message: InsertAnswerMessage = { type: 'insert-answer', id, text };
      const response: InsertAnswerResponse = await browser.tabs.sendMessage(tabId, message);
      if (response.inserted) {
        updateDraft(id, { inserted: true });
      } else {
        // The content script's element map is empty for this id — most likely
        // it was re-injected by a page navigation since the draft was made.
        updateDraft(id, {
          insertError: "Couldn't find that field on the page any more — press Draft answers again.",
        });
      }
    } catch (err) {
      // `sendMessage` rejects outright when no content script is listening —
      // a chrome:// page, a PDF viewer, or a tab open before install. The
      // user's edited text must stay on screen either way.
      updateDraft(id, {
        insertError:
          err instanceof Error ? err.message : 'Could not reach this page. Reload the tab, then try again.',
      });
    }
  };

  const handleSaveReusable = async (id: string, question: string, answer: string) => {
    updateDraft(id, { insertError: undefined });
    try {
      await queueProfileSave(question, answer);
      updateDraft(id, { saved: true });
    } catch (err) {
      updateDraft(id, {
        insertError: err instanceof Error ? err.message : 'Could not save this answer.',
      });
    }
  };

  const running = starting || run?.status === 'running';

  const entries = run?.entries ?? [];

  // What the run cost, priced from the catalogue when the model is in it. With
  // a rotating free pool a run can move between models and tiers, and without
  // this there is no way to tell a free run from a paid one.
  const [catalogue, setCatalogue] = useState<CatalogModel[]>([]);
  useEffect(() => {
    void getModels()
      .then(setCatalogue)
      .catch(() => setCatalogue([]));
  }, []);

  const usages = entries
    .filter((entry) => entry.usage && entry.model)
    .map((entry) => ({ model: entry.model!, input: entry.usage!.input, output: entry.usage!.output }));
  const runCost = usages.length > 0 ? summarizeRunCost(usages, catalogue) : null;
  const allCollapsed = entries.length > 0 && entries.every((e) => collapsed[e.id]);
  const toggleAll = () =>
    setCollapsed(allCollapsed ? {} : Object.fromEntries(entries.map((e) => [e.id, true])));
  const needsSetup = run?.status === 'error' && /Settings/i.test(run.message ?? '');

  return (
    <>
      <ActionRow
        icon={<DraftIcon />}
        title="Draft answers"
        description="Drafts replies to open-ended questions. You review before anything is entered."
        tint="neutral"
        onClick={handleDraft}
        disabled={running}
        collapsed={cardClosed}
        onToggleCollapse={() => setCardClosed((v) => !v)}
      >
        {running && (
          <span className="pill pill-neutral">
            {run?.total
              ? `Drafting ${Math.min(run.done + 1, run.total)} of ${run.total}…`
              : 'Looking for questions…'}
          </span>
        )}
        {run?.status === 'done' && <span className="pill pill-success">{run.entries.length} drafted</span>}
        {run?.status === 'error' && <span className="pill pill-danger">{run.message}</span>}
      </ActionRow>
      {!cardClosed && needsSetup && (
        <button type="button" className="btn-plain" onClick={() => onOpenSetup('ai')}>
          Set up AI drafting
        </button>
      )}

      {!cardClosed && run && run.entries.length > 0 && (
        <div className="drafts">
          <div className="drafts-toolbar">
            <span className="hint">
              {run.entries.length} question{run.entries.length === 1 ? '' : 's'}
              {runCost && ` · ${formatCost(runCost)}`}
            </span>
            <button type="button" className="btn-plain" onClick={toggleAll}>
              {allCollapsed ? 'Expand answers' : 'Collapse answers'}
            </button>
          </div>

          {run.entries.map((draft) => {
            const open = !collapsed[draft.id];
            return (
              <div className="draft" key={draft.id}>
                {/* A button, not a heading with a handler: collapsing has to be
                    reachable by keyboard, and the whole row is the target. */}
                <button
                  type="button"
                  className="draft-question"
                  aria-expanded={open}
                  onClick={() => setCollapsed((prev) => ({ ...prev, [draft.id]: open }))}
                >
                  <span className={`draft-chevron ${open ? 'draft-chevron-open' : ''}`} aria-hidden="true">
                    ▸
                  </span>
                  <span className="draft-question-text">{draft.question}</span>
                  {draft.saved && <span className="pill pill-neutral">saved answer</span>}
                  {!draft.saved && draft.model && (
                    <span
                      className="pill pill-neutral"
                      title="The model that answered — a rotating pool can use a different one per question"
                    >
                      {draft.model}
                    </span>
                  )}
                  {draft.inserted && <span className="pill pill-success">inserted</span>}
                  {draft.error && <span className="pill pill-danger">failed</span>}
                </button>

                {/* Hidden, never unmounted: the drafted text is preserved
                    exactly as it was, including unsaved edits, and nothing is
                    regenerated on reopening. */}
                <div className="draft-body" hidden={!open}>
                  {draft.error ? (
                    <span className="pill pill-danger">{draft.error}</span>
                  ) : (
                    <>
                      <textarea
                        aria-label={`Answer to: ${draft.question}`}
                        value={draft.text}
                        onChange={(e) => updateDraft(draft.id, { text: e.target.value })}
                      />
                      {draft.similar && (
                        <div className="notice notice-warning mt-2">
                          <p>
                            You saved an answer to a similar question:{' '}
                            <strong>{draft.similar.question}</strong>
                          </p>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => updateDraft(draft.id, { text: draft.similar!.text })}
                          >
                            Use that answer instead
                          </button>
                        </div>
                      )}
                      {draft.insertError && <span className="pill pill-danger">{draft.insertError}</span>}
                      <div className="actions mt-2">
                        <button className="btn btn-primary" onClick={() => handleInsert(draft.id, draft.text)}>
                          {draft.inserted ? 'Inserted' : 'Insert'}
                        </button>
                        <button
                          className="btn"
                          onClick={() => handleSaveReusable(draft.id, draft.question, draft.text)}
                        >
                          {draft.saved ? 'Saved' : 'Save for reuse'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
