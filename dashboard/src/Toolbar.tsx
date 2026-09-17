/**
 * Search, filters and the view switcher.
 *
 * One row, and it never wraps into two on a laptop. A filter that is doing
 * something says so with the accent and a count, so a list that looks short
 * is never mysteriously short.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CheckSquare,
  Kanban,
  MagnifyingGlass,
  SquaresFour,
  Table as TableIcon,
  X,
} from '@phosphor-icons/react';
import { PRIORITIES, STATUSES, type ApplicationStatus, type Priority } from './bridge';
import { EMPTY_QUERY, defaultDirectionFor, type Query, type SortKey, type ViewKind } from './records';

/**
 * Sorts worth offering where there are no column headers to click, in the
 * words the page uses for them — `appliedAt` is a field name, not a label.
 */
const SORT_LABELS: Record<SortKey, string> = {
  appliedAt: 'Newest',
  company: 'Company',
  title: 'Role',
  status: 'Status',
  priority: 'Priority',
  matchScore: 'Match',
  nextActionAt: 'Next action',
};

const SORTS: SortKey[] = ['appliedAt', 'company', 'status', 'priority', 'matchScore', 'nextActionAt'];

const VIEWS: Array<{ kind: ViewKind; label: string; icon: React.ReactNode }> = [
  { kind: 'table', label: 'Table', icon: <TableIcon size={14} weight="bold" /> },
  { kind: 'board', label: 'Board', icon: <Kanban size={14} weight="bold" /> },
  { kind: 'gallery', label: 'Gallery', icon: <SquaresFour size={14} weight="bold" /> },
];

/** Closes on an outside click and on Escape, which is the whole contract. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return ref;
}

function FilterMenu<T extends string>({
  label,
  options,
  selected,
  onToggle,
  single = false,
  labels,
}: {
  label: string;
  options: readonly T[];
  selected: T[];
  onToggle: (value: T) => void;
  /** Display names, where the value is not already what to show. */
  labels?: Record<string, string>;
  /** A one-of-these chooser rather than a filter. Sort is always set, so
   *  marking it as active and counting it to 1 would say nothing. */
  single?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  return (
    <div className="filter" ref={ref}>
      <button
        type="button"
        className={`filter-button${!single && selected.length > 0 ? ' filter-active' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((was) => !was)}
      >
        {label}
        {single ? (
          <span style={{ color: 'var(--text)' }}>{labels?.[selected[0]!] ?? selected[0]}</span>
        ) : (
          selected.length > 0 && <span className="filter-count">{selected.length}</span>
        )}
      </button>
      {open && (
        <div className="menu" role="menu">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemcheckbox"
              aria-checked={selected.includes(option)}
              onClick={() => onToggle(option)}
            >
              <span className="menu-check">
                {selected.includes(option) && <CheckSquare size={14} weight="fill" />}
              </span>
              {labels?.[option] ?? option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ToolbarProps {
  query: Query;
  onQuery: (next: Query) => void;
  view: ViewKind;
  onView: (next: ViewKind) => void;
  tags: string[];
  /** Focused by the / shortcut, which App owns because it listens globally. */
  searchRef: React.RefObject<HTMLInputElement | null>;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

export function Toolbar({ query, onQuery, view, onView, tags, searchRef }: ToolbarProps) {
  const filtered =
    query.statuses.length + query.priorities.length + query.tags.length > 0 || query.search !== '';

  return (
    <div className="toolbar">
      <div className="search">
        <MagnifyingGlass size={14} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query.search}
          placeholder="Search company, role, tags, or the posting itself…"
          aria-label="Search applications"
          onChange={(e) => onQuery({ ...query, search: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onQuery({ ...query, search: '' });
              e.currentTarget.blur();
            }
          }}
        />
      </div>

      <FilterMenu<ApplicationStatus>
        label="Status"
        options={STATUSES}
        selected={query.statuses}
        onToggle={(status) => onQuery({ ...query, statuses: toggle(query.statuses, status) })}
      />

      <FilterMenu<Priority>
        label="Priority"
        options={PRIORITIES}
        selected={query.priorities}
        onToggle={(priority) => onQuery({ ...query, priorities: toggle(query.priorities, priority) })}
      />

      {/* Only shown once tags exist. An empty filter is a control that does
          nothing and still has to be understood. */}
      {tags.length > 0 && (
        <FilterMenu<string>
          label="Tags"
          options={tags}
          selected={query.tags}
          onToggle={(tag) => onQuery({ ...query, tags: toggle(query.tags, tag) })}
        />
      )}

      {filtered && (
        <button
          type="button"
          className="filter-button"
          onClick={() => onQuery({ ...EMPTY_QUERY, sort: query.sort, direction: query.direction })}
        >
          <X size={12} weight="bold" aria-hidden="true" />
          Clear
        </button>
      )}

      {/* The table sorts from its own column headers, so only the views that
          have no headers of their own need a sort control here. */}
      {view !== 'table' && (
        <FilterMenu<SortKey>
          label="Sort"
          options={SORTS}
          labels={SORT_LABELS}
          selected={[query.sort]}
          single
          onToggle={(sort) => onQuery({ ...query, sort, direction: defaultDirectionFor(sort) })}
        />
      )}

      <div className="segmented" role="group" aria-label="View" style={{ marginLeft: 'auto' }}>
        {VIEWS.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            aria-pressed={view === entry.kind}
            onClick={() => onView(entry.kind)}
          >
            {entry.icon}
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}
