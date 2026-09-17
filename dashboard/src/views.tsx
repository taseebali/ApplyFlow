/**
 * The three ways to look at the same list.
 *
 * Table when the question is "what did I send and when", board when it is
 * "what is still moving", gallery when it is "which of these was actually a
 * good match". They share every component that draws a value, so switching
 * view changes the arrangement and never the meaning.
 */
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import type { ApplicationStatus, TransferableRecord } from './bridge';
import { groupByStatus, type Query, type SortKey } from './records';
import { DueDate, Meter, PriorityBars, RelativeDate, StatusTag } from './ui';

export interface ViewProps {
  records: TransferableRecord[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}

/* ---- table ---- */

const COLUMNS: Array<{ key: SortKey; label: string; width?: string }> = [
  { key: 'company', label: 'Company' },
  { key: 'status', label: 'Status', width: '116px' },
  { key: 'priority', label: 'Priority', width: '86px' },
  { key: 'matchScore', label: 'Match', width: '140px' },
  { key: 'nextActionAt', label: 'Next', width: '180px' },
  { key: 'appliedAt', label: 'Applied', width: '124px' },
];

export function TableView({
  records,
  selectedId,
  onOpen,
  query,
  onSort,
}: ViewProps & { query: Query; onSort: (key: SortKey) => void }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const active = query.sort === column.key;
              return (
                <th
                  key={column.key}
                  style={{ width: column.width }}
                  // Only the column actually sorted carries aria-sort; setting
                  // it to "none" on the others makes a screen reader announce
                  // six sort states where there is one.
                  aria-sort={active ? (query.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <button type="button" onClick={() => onSort(column.key)}>
                    {column.label}
                    {active &&
                      (query.direction === 'asc' ? (
                        <CaretUp size={10} weight="bold" aria-hidden="true" />
                      ) : (
                        <CaretDown size={10} weight="bold" aria-hidden="true" />
                      ))}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={record.id}
              tabIndex={0}
              aria-selected={record.id === selectedId}
              onClick={() => onOpen(record.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen(record.id);
                }
              }}
            >
              <td>
                <span className="cell-company">{record.company || record.hostname}</span>
                <span className="cell-sub">{record.title || record.hostname}</span>
              </td>
              <td>
                <StatusTag status={record.status} />
              </td>
              <td>
                <PriorityBars priority={record.priority} />
              </td>
              <td>
                <Meter score={record.matchScore} />
              </td>
              <td className="cell-sub" style={{ display: 'table-cell' }}>
                {record.nextAction ? (
                  <>
                    <span style={{ color: 'var(--text)' }}>{record.nextAction}</span>
                    <span className="cell-sub">
                      <DueDate at={record.nextActionAt} />
                    </span>
                  </>
                ) : (
                  <DueDate at={record.nextActionAt} />
                )}
              </td>
              <td className="cell-num cell-muted">
                <RelativeDate at={record.appliedAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- board ---- */

/**
 * A card, on the board and in the gallery.
 *
 * A `<button>` rather than a div with a click handler: it is focusable, it
 * answers Enter and Space, and a screen reader announces it as something that
 * can be activated — all of which a div would have to be told to do by hand.
 */
function Card({
  record,
  selected,
  onOpen,
  draggable = false,
  onDragStart,
  onDragEnd,
  dragging = false,
  children,
}: {
  record: TransferableRecord;
  selected: boolean;
  onOpen: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  dragging?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`card${dragging ? ' card-dragging' : ''}`}
      style={selected ? { borderColor: 'var(--accent)' } : undefined}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', record.id);
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      <span className="card-title">{record.company || record.hostname}</span>
      <span className="card-meta">{record.title || record.hostname}</span>
      {children}
      <span className="card-meta">
        <PriorityBars priority={record.priority} />
        {record.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="tag-chip" style={{ paddingRight: 8 }}>
            {tag}
          </span>
        ))}
        {record.nextActionAt !== null && <DueDate at={record.nextActionAt} />}
      </span>
    </button>
  );
}

export function BoardView({
  records,
  selectedId,
  onOpen,
  onMove,
  dragging,
  onDragging,
}: ViewProps & {
  onMove: (id: string, status: ApplicationStatus) => void;
  dragging: string | null;
  onDragging: (id: string | null) => void;
}) {
  const columns = groupByStatus(records);

  return (
    <div className="board">
      {columns.map(({ status, records: inColumn }) => (
        <section key={status} className="board-column" aria-label={`${status}, ${inColumn.length}`}>
          <header className="board-head">
            <StatusTag status={status} />
            <span className="board-tally">{inColumn.length}</span>
          </header>
          <div
            className="board-drop"
            onDragOver={(e) => {
              // Without this the browser refuses the drop outright: preventing
              // dragover is what marks an element as a valid target at all.
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              e.currentTarget.classList.add('board-drop-over');
            }}
            onDragLeave={(e) => e.currentTarget.classList.remove('board-drop-over')}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('board-drop-over');
              const id = e.dataTransfer.getData('text/plain');
              if (id) onMove(id, status);
            }}
          >
            {inColumn.map((record) => (
              <Card
                key={record.id}
                record={record}
                selected={record.id === selectedId}
                onOpen={() => onOpen(record.id)}
                draggable
                dragging={dragging === record.id}
                onDragStart={() => onDragging(record.id)}
                onDragEnd={() => onDragging(null)}
              />
            ))}
            {inColumn.length === 0 && <p className="board-empty">Nothing here.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---- gallery ---- */

export function GalleryView({ records, selectedId, onOpen }: ViewProps) {
  return (
    <div className="gallery">
      {records.map((record) => (
        <Card
          key={record.id}
          record={record}
          selected={record.id === selectedId}
          onOpen={() => onOpen(record.id)}
        >
          <span className="card-meta">
            <StatusTag status={record.status} />
            <RelativeDate at={record.appliedAt} />
          </span>
          <span className="gallery-score">
            <Meter score={record.matchScore} />
          </span>
        </Card>
      ))}
    </div>
  );
}
