import { FillAndAttachSection } from '@/components/FillSection';
import { TailorCard } from '@/components/TailorCard';
import { DraftAnswersCard } from '@/components/DraftAnswersSection';
import { LogToNotionSection } from '@/components/NotionSection';
import { ReadinessBar } from '@/components/ReadinessBar';
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
  return (
    <div className="daily-actions">
      <ReadinessBar onOpen={onOpenSetup} />
      <div className="action-rows">
        <FillAndAttachSection onOpenSetup={onOpenSetup} />
        <TailorCard posting={posting} onOpenSetup={onOpenSetup} />
        <DraftAnswersCard onOpenSetup={onOpenSetup} />
        <LogToNotionSection onOpenSetup={onOpenSetup} />
      </div>
    </div>
  );
}
