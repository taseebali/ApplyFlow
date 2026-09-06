import { useState } from 'react';
import { setFieldOverride } from '@/lib/field-overrides';
import { SCHEMA_FIELDS } from '@/lib/schema';
import type { UnrecognizedField } from '@/lib/field-matcher';

/**
 * Lets the user say what a field actually was, once, and remembers it for
 * this site. Fill accuracy then improves with use instead of staying flat.
 */
export function TeachFieldsPanel({
  fields,
  hostname,
  onTaught,
}: {
  fields: UnrecognizedField[];
  hostname: string;
  onTaught: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const teach = async (signature: string, path: string) => {
    if (!path) return;
    setSaving(signature);
    try {
      await setFieldOverride(hostname, signature, path);
      // Re-fill straight away so the effect is visible rather than promised.
      onTaught();
    } finally {
      setSaving(null);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn-plain teach-toggle" onClick={() => setOpen(true)}>
        {fields.length} field{fields.length === 1 ? '' : 's'} not recognised — tell ApplyFlow what they are
      </button>
    );
  }

  return (
    <div className="teach-panel">
      <p className="teach-intro">
        Pick what each field is. ApplyFlow remembers it for <strong>{hostname}</strong> only.
      </p>
      {fields.map((field) => (
        <div className="teach-row" key={field.signature}>
          <span className="teach-label" title={field.signature}>
            {field.label}
          </span>
          <select
            defaultValue=""
            disabled={saving === field.signature}
            onChange={(e) => teach(field.signature, e.target.value)}
          >
            <option value="">Skip</option>
            {SCHEMA_FIELDS.map((f) => (
              <option key={f.path} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button type="button" className="btn-plain" onClick={() => setOpen(false)}>
        Done
      </button>
    </div>
  );
}
