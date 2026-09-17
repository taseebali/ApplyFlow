/**
 * The editable half of a record.
 *
 * Everything else the dashboard shows is what actually went out and is not
 * editable here on purpose. These six fields are the ones only a person can
 * know, so they are the ones the extension accepts a write for — see
 * `readProperties` in extension/lib/dashboard-bridge.ts, which validates every
 * one of them again on arrival.
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarBlank, Check, Tag, Target, TrendUp, CurrencyEur } from '@phosphor-icons/react';
import { PRIORITIES, STATUSES, type EditableProperties, type Priority } from './bridge';
import { PriorityBars, StatusTag, fromDateInput, toDateInput } from './ui';

/** Long enough to finish a word, short enough that nobody wonders if it saved. */
const SAVE_DELAY_MS = 600;

export interface PropertiesProps {
  value: EditableProperties;
  onChange: (patch: Partial<EditableProperties>) => void;
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="prop">
      <div className="prop-label">
        <span aria-hidden="true" style={{ display: 'flex', color: 'var(--text-muted)' }}>{icon}</span>
        {label}
      </div>
      <div className="prop-value">{children}</div>
    </div>
  );
}

/**
 * A text field that saves itself.
 *
 * There is no Save button anywhere on this page, so the rules have to cover
 * every way a person stops typing: a pause, a blur, and Escape to put the
 * field back. The pending timer is cleared on unmount, otherwise closing the
 * panel mid-edit fires a write against a record nothing is showing any more.
 */
function SelfSavingInput({
  value,
  placeholder,
  ariaLabel,
  onCommit,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A change from elsewhere (a different record opened into the same panel)
  // replaces the draft. Skipped while the field has focus, so a save landing
  // mid-word never yanks the cursor.
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (next: string) => {
    clearTimeout(timer.current);
    if (next === value) return;
    onCommit(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        className="prop-input"
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setDraft(e.target.value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(e.target.value), SAVE_DELAY_MS);
        }}
        onBlur={() => {
          focused.current = false;
          commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            clearTimeout(timer.current);
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
      />
      {saved && (
        <span className="prop-saved" role="status">
          <Check size={12} weight="bold" /> Saved
        </span>
      )}
    </span>
  );
}

/**
 * Tags, committed one at a time.
 *
 * A comma-separated text field cannot hold a tag with a comma in it and
 * re-parses the whole list on every keystroke. A chip is committed once and
 * then only ever removed whole — the same control, and the same reasoning, as
 * the panel's TagInput.
 */
function TagEditor({ tags, onChange }: { tags: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const tag = draft.trim();
    setDraft('');
    if (!tag) return;
    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return;
    onChange([...tags, tag]);
  };

  return (
    <div className="prop-tags">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button
            type="button"
            className="tag-chip-x"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(tags.filter((t) => t !== tag))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={tags.length === 0 ? 'Add a tag…' : ''}
        aria-label="Add a tag"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
          // Backspace on an empty field removes the last chip, which is what
          // every other chip control does and what fingers expect.
          if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

export function Properties({ value, onChange }: PropertiesProps) {
  return (
    <div className="props">
      <Row icon={<Target size={14} />} label="Status">
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            className="prop-select"
            style={{ width: 'auto' }}
            value={value.status}
            aria-label="Status"
            onChange={(e) => onChange({ status: e.target.value as EditableProperties['status'] })}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <StatusTag status={value.status} />
        </span>
      </Row>

      <Row icon={<TrendUp size={14} />} label="Priority">
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            className="prop-select"
            style={{ width: 'auto' }}
            value={value.priority}
            aria-label="Priority"
            onChange={(e) => onChange({ priority: e.target.value as Priority })}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          <PriorityBars priority={value.priority} />
        </span>
      </Row>

      <Row icon={<Tag size={14} />} label="Tags">
        <TagEditor tags={value.tags} onChange={(tags) => onChange({ tags })} />
      </Row>

      <Row icon={<Check size={14} />} label="Next action">
        <SelfSavingInput
          value={value.nextAction}
          placeholder="Follow up with the recruiter…"
          ariaLabel="Next action"
          onCommit={(nextAction) => onChange({ nextAction })}
        />
      </Row>

      <Row icon={<CalendarBlank size={14} />} label="Due">
        <input
          type="date"
          className="prop-input"
          style={{ width: 'auto' }}
          value={toDateInput(value.nextActionAt)}
          aria-label="Next action due date"
          onChange={(e) => onChange({ nextActionAt: fromDateInput(e.target.value) })}
        />
      </Row>

      <Row icon={<CurrencyEur size={14} />} label="Salary">
        <SelfSavingInput
          value={value.salary}
          placeholder="What the posting said, e.g. €65–75k…"
          ariaLabel="Salary"
          onCommit={(salary) => onChange({ salary })}
        />
      </Row>
    </div>
  );
}
