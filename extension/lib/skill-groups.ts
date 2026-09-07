/**
 * Skills, as rows of chips rather than a string the user has to punctuate.
 *
 * Storage stays `string[]`, because that is what `groupSkills` in
 * resume-document reads: an entry shaped `"Label: a, b"` is a group and a bare
 * entry is a loose skill. The editor should not make the user type that shape,
 * so these two functions convert between it and the rows the UI draws.
 *
 * Round-tripping matters more than it looks. Everything loose collapses into
 * one unlabelled row, exactly as the resume renders it, so what you edit is
 * laid out the way it will print.
 */
export interface SkillRow {
  /** Empty for the ungrouped row. */
  label: string;
  items: string[];
}

/**
 * A label, a colon, then the items.
 *
 * The trailing `(?!\/)` is what stops "https://example.com" becoming a group
 * called "https" — a URL is one skill entry, or more likely a stray paste, and
 * either way it is not a heading.
 */
const GROUP = /^([^:]{2,40}):\s*(?!\/)(.+)$/;

export function parseSkillRows(skills: string[]): SkillRow[] {
  const rows: SkillRow[] = [];
  const loose: string[] = [];

  for (const entry of skills) {
    const match = entry.match(GROUP);
    if (match) {
      rows.push({
        label: match[1]!.trim(),
        items: match[2]!.split(',').map((item) => item.trim()).filter(Boolean),
      });
    } else if (entry.trim()) {
      loose.push(entry.trim());
    }
  }

  // Last, because that is where the resume prints it.
  if (loose.length > 0) rows.push({ label: '', items: loose });
  return rows;
}

export function serializeSkillRows(rows: SkillRow[]): string[] {
  return rows.flatMap((row) => {
    const items = row.items.map((item) => item.trim()).filter(Boolean);
    if (items.length === 0) return [];
    // A label with no items is not a group, and a group with a label is one
    // entry however many items it holds.
    return row.label.trim() ? [`${row.label.trim()}: ${items.join(', ')}`] : items;
  });
}
