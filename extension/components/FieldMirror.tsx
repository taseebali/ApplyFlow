import { useEffect, useState } from 'react';
import { ArrowSquareOutIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { byGroup, tally, withFrame, type FieldStatus, type FormPlan, type PlannedField } from '@/lib/field-plan';
import { getActiveTabId, listFillableFrames } from '@/lib/active-tab';
import type { PlanFormMessage } from '@/entrypoints/content';

/**
 * The form, mirrored.
 *
 * Reading this list top to bottom is reading the page top to bottom. The panel
 * used to show four things it could do; it now shows every field on the form in
 * front of you and where each one stands, which is the thing the user is
 * actually trying to find out.
 *
 * Colour carries the state and the tag carries the same state in words, so
 * nothing here depends on being able to tell green from amber.
 */

const TAG: Record<FieldStatus, { label: string; tone: string } | null> = {
  done: null,
  ready: null,
  you: { label: 'You', tone: 'wait' },
  ai: { label: 'Draft', tone: 'ai' },
  skip: { label: 'Skip', tone: 'off' },
};

const DOT: Record<FieldStatus, string> = {
  done: 'ok',
  ready: 'ok',
  you: 'wait',
  ai: 'ai',
  skip: 'off',
};

export interface FormPlanState {
  plan: FormPlan | null;
  loading: boolean;
  refresh: () => void;
}

export function useFormPlan(): FormPlanState {
  const [plan, setPlan] = useState<FormPlan | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    void (async () => {
      try {
        setPlan(await planAcrossFrames(await getActiveTabId()));
      } catch {
        // No content script here: a new tab, a PDF, the store. Not an error,
        // just nothing to mirror.
        setPlan(null);
      } finally {
        setLoading(false);
      }
    })();
  };

  useEffect(refresh, []);

  return { plan, loading, refresh };
}

/**
 * Every frame's plan, merged.
 *
 * An untargeted message reaches all frames and keeps whichever answers first,
 * so an application inside an iframe had its plan answered by the top frame -
 * which has no form. That is why the panel could say "no application form
 * here" while looking straight at one. Each frame is asked by id, and each
 * field carries the frame it came from so a click can reach it.
 */
async function planAcrossFrames(tabId: number): Promise<FormPlan | null> {
  const frames = await listFillableFrames(tabId);
  const targets: Array<number | null> = frames.length > 0 ? frames.map((f) => f.frameId) : [null];

  const plans = await Promise.all(
    targets.map(async (frameId) => {
      try {
        const plan: FormPlan = await browser.tabs.sendMessage(
          tabId,
          { type: 'plan-form' } satisfies PlanFormMessage,
          frameId === null ? {} : { frameId }
        );
        return { frameId, plan };
      } catch {
        return null;
      }
    })
  );

  const found = plans.filter((entry): entry is { frameId: number | null; plan: FormPlan } => entry !== null);
  if (found.length === 0) return null;

  return {
    hostname: found[0]!.plan.hostname,
    fields: found.flatMap(({ frameId, plan }) =>
      plan.fields.map((field) => ({ ...field, id: withFrame(frameId, field.id) }))
    ),
  };
}

export function Tally({ plan }: { plan: FormPlan }) {
  const counts = tally(plan.fields);
  return (
    <div className="tally">
      <div>
        <b className="mono">{counts.total}</b>
        <span>fields</span>
      </div>
      <div className="tally-ok">
        <b className="mono">{counts.ready}</b>
        <span>ready</span>
      </div>
      <div className="tally-wait">
        <b className="mono">{counts.you}</b>
        <span>you</span>
      </div>
      <div className="tally-ai">
        <b className="mono">{counts.ai}</b>
        <span>draft</span>
      </div>
    </div>
  );
}

function valueOf(field: PlannedField): string {
  if (field.status === 'you') return field.current || 'Needs you';
  if (field.status === 'ai') return field.current || 'Not answered yet';
  if (field.status === 'skip') return field.current || 'Left blank, optional';
  return field.proposed;
}

export function FieldRow({
  field,
  onJump,
  onPick,
}: {
  field: PlannedField;
  onJump: (field: PlannedField) => void;
  onPick?: (field: PlannedField, value: string) => void;
}) {
  const tag = TAG[field.status];
  const muted = field.status === 'skip' || field.status === 'you' || field.status === 'ai';

  /*
   * The answers the control itself offers, shown only when we have nothing to
   * write. The page has been displaying this list the whole time; matching used
   * to guess a string against it and a combobox with no native select had
   * neither a value to read nor a list to check against. One click is the whole
   * interaction.
   */
  const choices = field.status === 'you' && onPick ? (field.options ?? []) : [];

  const row = (
    <button type="button" className="field-row" onClick={() => onJump(field)} title={field.label}>
      <span className={`dot dot-${DOT[field.status]}`} aria-hidden="true" />
      <span className="field-name mono">{field.name}</span>
      <span className={`field-value ${muted ? `field-value-${DOT[field.status]}` : ''}`}>
        {valueOf(field)}
        {field.count && field.count > 1 && <span className="field-count mono"> ×{field.count}</span>}
      </span>
      {tag ? (
        <span className={`tag tag-${tag.tone}`}>{tag.label}</span>
      ) : (
        <span className="field-go" aria-hidden="true">
          <ArrowSquareOutIcon size={15} weight="light" />
        </span>
      )}
      {/* The dot is colour; this is the same fact in words, for anyone who
          cannot use the colour. */}
      <span className="sr-only">{field.status}</span>
    </button>
  );

  if (choices.length === 0) return row;

  return (
    <div className="field-row-group">
      {row}
      <div className="field-options" role="group" aria-label={`Answers ${field.label} accepts`}>
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            className="field-option"
            onClick={() => onPick!(field, choice)}
          >
            {choice}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FieldMirror({
  plan,
  loading,
  onJump,
  onPick,
}: {
  plan: FormPlan | null;
  loading: boolean;
  onJump: (field: PlannedField) => void;
  /** Writes one answer the user picked from the control's own list. */
  onPick?: (field: PlannedField, value: string) => void;
}) {
  if (loading) {
    return (
      <div className="mirror-loading" aria-hidden="true">
        {[68, 84, 52, 76, 60].map((width, i) => (
          <span key={i} className="skel" style={{ width: `${width}%` }} />
        ))}
      </div>
    );
  }

  if (!plan || plan.fields.length === 0) {
    return (
      <div className="empty">
        <MagnifyingGlassIcon size={26} weight="light" />
        <b>No application form here</b>
        <p className="hint">Open a job application and every field on it shows up in this list.</p>
      </div>
    );
  }

  return (
    <div className="mirror">
      {byGroup(plan.fields).map(([group, fields]) => (
        <div key={group}>
          <p className="group-label">{group}</p>
          {fields.map((field) => (
            <FieldRow key={field.id} field={field} onJump={onJump} onPick={onPick} />
          ))}
        </div>
      ))}
    </div>
  );
}
