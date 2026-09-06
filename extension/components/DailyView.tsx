import { FillAndAttachSection } from '@/components/FillSection';
import { TailorCard } from '@/components/TailorCard';
import { DraftAnswersCard } from '@/components/DraftAnswersSection';
import { LogToNotionSection } from '@/components/NotionSection';
import { ReadinessBar } from '@/components/ReadinessBar';
import { FieldMirror, Tally, useFormPlan } from '@/components/FieldMirror';
import { getActiveTabId } from '@/lib/active-tab';
import type { JumpToFieldMessage } from '@/entrypoints/content';
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
export function DailyView({ posting, onOpenSetup }: { posting: Posting; onOpenSetup: OpenSetup }) {
  const { plan, loading } = useFormPlan();

  /** A row is a control: clicking it takes you to the field it names. */
  const jump = (field: PlannedField) => {
    void (async () => {
      const tabId = await getActiveTabId();
      await browser.tabs.sendMessage(tabId, {
        type: 'jump-to-field',
        fieldId: field.id,
      } satisfies JumpToFieldMessage);
    })().catch(() => undefined);
  };

  return (
    <div className="daily-actions">
      <ReadinessBar onOpen={onOpenSetup} />

      {plan && plan.fields.length > 0 && <Tally plan={plan} />}
      <FieldMirror plan={plan} loading={loading} onJump={jump} />

      <div className="action-rows">
        <FillAndAttachSection onOpenSetup={onOpenSetup} />
        <TailorCard posting={posting} onOpenSetup={onOpenSetup} />
        <DraftAnswersCard onOpenSetup={onOpenSetup} />
        <LogToNotionSection onOpenSetup={onOpenSetup} />
      </div>
    </div>
  );
}
