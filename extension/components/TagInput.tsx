import { useRef, useState } from 'react';

/**
 * A list of terms, entered as chips.
 *
 * The field this replaces split and trimmed the whole string on every
 * keystroke, so the space or comma you typed was deleted the instant you typed
 * it — "Python kf" arrived as "Pythonkf" and a second skill was impossible to
 * enter. The fix is the shape of the control, not a better split: what you are
 * typing lives in local state and is never rewritten, and the committed list
 * only changes when a chip is actually added or removed.
 *
 * Modelled on Emblor's shadcn/ui tag input: type, press Enter, the term becomes
 * a chip with a remove button inside the field.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Accessible name for the text field — every one of these sits in a group. */
  label: string;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (text: string) => {
    const term = text.trim();
    setDraft('');
    if (!term) return;
    // Case-insensitive, because "Docker" and "docker" on one resume reads as
    // carelessness rather than as two skills.
    if (value.some((existing) => existing.toLowerCase() === term.toLowerCase())) return;
    onChange([...value, term]);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter inside a form would submit it, and a comma is the separator
      // people reach for out of habit — both mean "that is one term".
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="tag-input" onClick={() => inputRef.current?.focus()}>
      {value.map((term, index) => (
        <span className="tag-chip" key={`${term}-${index}`}>
          {term}
          <button
            type="button"
            className="tag-chip-x"
            aria-label={`Remove ${term}`}
            onClick={(event) => {
              event.stopPropagation();
              onChange(value.filter((_, i) => i !== index));
            }}
          >
            {/* A glyph rather than an icon import: this is 10px and inline. */}
            <span aria-hidden="true">×</span>
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        aria-label={label}
        value={draft}
        placeholder={value.length === 0 ? placeholder : ''}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        // Clicking away with a half-typed term should keep it. Losing it is
        // the same complaint as the old field, one step later.
        onBlur={() => commit(draft)}
        // Pasting a list is how anyone with an existing resume fills this.
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          if (!/[,;\n]/.test(text)) return;
          event.preventDefault();
          const terms = text.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
          const next = [...value];
          for (const term of terms) {
            if (!next.some((existing) => existing.toLowerCase() === term.toLowerCase())) next.push(term);
          }
          onChange(next);
        }}
      />
    </div>
  );
}
