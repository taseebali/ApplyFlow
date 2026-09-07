import { useState } from 'react';
import { FillAndAttachSection } from '@/components/FillSection';
import { TailorCard } from '@/components/TailorCard';
import { DraftAnswersCard } from '@/components/DraftAnswersSection';
import { LogToNotionSection } from '@/components/NotionSection';
import { ReadinessBar, useReadiness } from '@/components/ReadinessBar';
import { SpendLine } from '@/components/SpendLine';
import { FieldMirror, Tally, type FormPlanState } from '@/components/FieldMirror';
import { DiffSheet } from '@/components/DiffSheet';
import { usePrimaryAction } from '@/components/PrimaryAction';
import { frameOf, localId, writable } from '@/lib/field-plan';
import type { FillPageMessage, FillPageResponse } from '@/entrypoints/content';
import { getActiveTabId } from '@/lib/active-tab';
import type { JumpToFieldMessage, PickOptionMessage } from '@/entrypoints/content';
import type { PlannedField } from '@/lib/field-plan';
import type { Posting } from '@/components/JobContext';
import type { OpenSetup } from '@/components/panel-types';

/**
 * The working surface: what this application needs, then the actions, in the
 * order they are used.
 *
 * Each section owns its own logic in its own file. This was one 1088-line
 * module holding four unrelated ones.
 */
export function DailyView({
  posting,
  onOpenSetup,
  formPlan,
}: {
  posting: Posting;
  onOpenSetup: OpenSetup;
  /** Owned by the shell, because the command palette reads it too. Planning
   *  twice would mean two passes over the page for one screen. */
  formPlan: FormPlanState;
}) {
  const { plan, loading, refresh } = formPlan;
  const [reviewing, setReviewing] = useState(false);
  const [writing, setWriting] = useState(false);
  const readiness = useReadiness();

  const changes = plan ? writable(plan.fields) : [];

  /**
   * Nothing is written from here. Fill opens the diff; the diff writes.
   */
  usePrimaryAction(
    plan && changes.length > 0 && !reviewing
      ? {
          label: `Review ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`,
          onClick: () => setReviewing(true),
          // A half-filled application the form refuses at submit is worse than
          // one that was never started.
          disabled: readiness ? !readiness.ready : false,
        }
      : null,
    [plan, changes.length, reviewing, readiness?.ready]
  );

  const apply = (fieldIds: string[]) => {
    setWriting(true);
    void (async () => {
      try {
        const tabId = await getActiveTabId();
        // Grouped by frame: each content script only knows the ids it issued,
        // and an untargeted send would have every other frame write nothing
        // and answer first.
        const byFrame = new Map<number | null, string[]>();
        for (const id of fieldIds) {
          const frameId = frameOf(id);
          byFrame.set(frameId, [...(byFrame.get(frameId) ?? []), localId(id)]);
        }

        await Promise.all(
          [...byFrame.entries()].map(([frameId, only]) =>
            browser.tabs
              .sendMessage(tabId, { type: 'fill-page', only } satisfies FillPageMessage,
                frameId === null ? {} : { frameId })
              .catch(() => undefined)
          )
        );
      } finally {
        setWriting(false);
        setReviewing(false);
        // Re-read the form: what was just written should now show as done.
        refresh();
      }
    })();
  };

  /** A row is a control: clicking it takes you to the field it names. */
  const jump = (field: PlannedField) => {
    void (async () => {
      const tabId = await getActiveTabId();
      const frameId = frameOf(field.id);
      await browser.tabs.sendMessage(
        tabId,
        { type: 'jump-to-field', fieldId: localId(field.id) } satisfies JumpToFieldMessage,
        frameId === null ? {} : { frameId }
      );
    })().catch(() => undefined);
  };

  /**
   * Writes one answer the user picked off the control's own option list. Not
   * part of the fill: this value came from the page, and nothing chose it but
   * the user, so it goes to exactly one field.
   */
  const pick = (field: PlannedField, value: string) => {
    void (async () => {
      const tabId = await getActiveTabId();
      const frameId = frameOf(field.id);
      await browser.tabs.sendMessage(
        tabId,
        { type: 'pick-option', fieldId: localId(field.id), value } satisfies PickOptionMessage,
        frameId === null ? {} : { frameId }
      );
      await refresh();
    })().catch(() => undefined);
  };

  if (reviewing && plan) {
    return (
      <div className="daily-actions">
        <DiffSheet plan={plan} onCancel={() => setReviewing(false)} onApply={apply} />
        {writing && <p className="hint">Writing…</p>}
      </div>
    );
  }

  return (
    <div className="daily-actions">
      <ReadinessBar onOpen={onOpenSetup} />

      {plan && plan.fields.length > 0 && <Tally plan={plan} />}
      <FieldMirror plan={plan} loading={loading} onJump={jump} onPick={pick} />

      <div className="action-rows">
        <FillAndAttachSection onOpenSetup={onOpenSetup} />
        <TailorCard posting={posting} onOpenSetup={onOpenSetup} />
        <DraftAnswersCard onOpenSetup={onOpenSetup} />
        <LogToNotionSection onOpenSetup={onOpenSetup} />
      </div>

      <SpendLine />
    </div>
  );
}
