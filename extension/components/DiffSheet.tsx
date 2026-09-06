import { useState } from 'react';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { writable, type FormPlan, type PlannedField } from '@/lib/field-plan';

/**
 * What is about to be written, before it is written.
 *
 * The old flow wrote first and reported after, so a wrong value was found by
 * looking at the page. Here the old value is struck through and the new one
 * sits under it, per field, so one bad answer means skipping one field rather
 * than rejecting the whole run.
 *
 * The list is `writable()` and nothing else: fields that already hold the right
 * value, and fields only the user can answer, are not changes and do not belong
 * in a list of changes.
 */
export function DiffSheet({
  plan,
  onCancel,
  onApply,
}: {
  plan: FormPlan;
  onCancel: () => void;
  onApply: (fieldIds: string[]) => void;
}) {
  const changes = writable(plan.fields);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const approved = changes.filter((field) => !skipped.has(field.id));

  return (
    <div className="sheet">
      <div className="sheet-head">
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Back to the field list">
          <ArrowLeftIcon size={17} weight="light" />
        </button>
        <h2 className="sheet-title">
          {changes.length} {changes.length === 1 ? 'change' : 'changes'} to write
        </h2>
        <kbd>Esc</kbd>
      </div>

      {changes.length === 0 ? (
        <div className="empty">
          <b>Nothing to write</b>
          <p className="hint">Every field this form asks for already holds what your profile says.</p>
        </div>
      ) : (
        <div className="diff">
          {changes.map((field) => (
            <DiffRow
              key={field.id}
              field={field}
              skipped={skipped.has(field.id)}
              onToggle={() => toggle(field.id)}
            />
          ))}
        </div>
      )}

      <div className="sheet-foot">
        <div className="actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={approved.length === 0}
            onClick={() => onApply(approved.map((field) => field.id))}
          >
            Write {approved.length} <kbd>⏎</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

function DiffRow({
  field,
  skipped,
  onToggle,
}: {
  field: PlannedField;
  skipped: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`diff-row ${skipped ? 'diff-row-skipped' : ''}`}>
      <div className="diff-head">
        <span className={`dot dot-${skipped ? 'off' : 'ok'}`} aria-hidden="true" />
        <span className="field-name mono">{field.name}</span>
        {field.count && field.count > 1 && <span className="tag tag-off">{field.count} fields</span>}
        <span className="diff-spacer" />
        <button type="button" className="btn-mini" onClick={onToggle}>
          {skipped ? 'Include' : 'Skip'}
        </button>
      </div>

      {/* Only shown when something is being replaced. An empty field being
          filled has no "before" worth a line. */}
      {field.current.trim() && (
        <p className="diff-old">
          <span className="diff-mark mono" aria-hidden="true">
            -
          </span>
          <span>{field.current}</span>
        </p>
      )}
      <p className="diff-new">
        <span className="diff-mark mono" aria-hidden="true">
          +
        </span>
        <span>{field.proposed}</span>
      </p>
    </div>
  );
}
