

/**
 * The three controls every section in the app is built from.
 */

/**
 * Marks a field an application cannot be filled without. Empty ones are also
 * counted up on the Fill card, so the warning and the tag agree on what
 * "required" means: see `lib/profile-completeness.ts`.
 */
export function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span>
      {label}
      {required && <span className="required-tag">Required</span>}
    </span>
  );
}

export function TextField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="field">
      <FieldLabel label={label} required={required} />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/**
 * A dropdown for anything an application form would also present as a
 * dropdown. Keeping the wording identical to the standard EEO options used by
 * Greenhouse, Lever and similar means the saved value can be matched against
 * a form's own options instead of being typed as free text.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  required,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="field">
      <FieldLabel label={label} required={required} />
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not set</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {/* A value imported from JSON may predate these options. */}
        {value && !options.includes(value) && <option value={value}>{value}</option>}
      </select>
    </label>
  );
}
