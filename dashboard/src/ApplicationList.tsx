import type { TransferableRecord } from './bridge';

const date = (ms: number) => new Date(ms).toLocaleDateString();

export function ApplicationList({
  records,
  onOpen,
}: {
  records: TransferableRecord[];
  onOpen: (id: string) => void;
}) {
  if (records.length === 0) {
    return <p className="hint">Nothing applied for yet. Fill an application and it appears here.</p>;
  }

  return (
    <table className="dash-table">
      <thead>
        <tr>
          <th>Company</th>
          <th>Role</th>
          <th>Applied</th>
          <th>Match</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.id} onClick={() => onOpen(r.id)} tabIndex={0}>
            <td>{r.company || r.hostname}</td>
            <td>{r.title}</td>
            <td>{date(r.appliedAt)}</td>
            <td>{r.matchScore ?? '—'}</td>
            <td><span className={`chip chip-${r.status}`}>{r.status}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
