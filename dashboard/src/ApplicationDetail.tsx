import { useEffect, useState } from 'react';
import { askExtension, toBlobUrl, STATUSES, type DetailedRecord, type ApplicationStatus } from './bridge';

export function ApplicationDetail({
  id,
  onBack,
  onChanged,
}: {
  id: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [record, setRecord] = useState<DetailedRecord | null>(null);

  useEffect(() => {
    void askExtension({ type: 'get', id }).then((r) => {
      if (r.ok && r.record) setRecord(r.record);
    });
  }, [id]);

  if (!record) return <p className="hint">Loading…</p>;

  const setStatus = async (status: ApplicationStatus) => {
    await askExtension({ type: 'set-status', id, status });
    setRecord({ ...record, status });
    onChanged();
  };

  return (
    <article className="dash-detail">
      <button type="button" onClick={onBack}>← All applications</button>

      <h2>{record.company} — {record.title}</h2>
      <p><a href={record.url} target="_blank" rel="noreferrer">{record.url}</a></p>

      <label>
        Status{' '}
        <select value={record.status} onChange={(e) => void setStatus(e.target.value as ApplicationStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <section>
        <h3>What was sent</h3>
        <ul>
          {/* Downloaded from bytes held on this machine. Nothing was uploaded
              to produce this link. */}
          {record.resume && (
            <li>
              <a href={toBlobUrl(record.resume.base64)} download={record.resume.filename}>
                {record.resume.filename}
              </a>
            </li>
          )}
          {record.coverLetter && (
            <li>
              <a href={toBlobUrl(record.coverLetter.base64)} download={record.coverLetter.filename}>
                {record.coverLetter.filename}
              </a>
            </li>
          )}
          {!record.resume && !record.coverLetter && <li className="hint">No documents recorded.</li>}
        </ul>
      </section>

      <section>
        <h3>Match</h3>
        <p>{record.matchScore === null ? 'Not scored.' : `${record.matchScore} / 100`}</p>
        <p className="hint">Covered: {record.gapCovered.join(', ') || '—'}</p>
        <p className="hint">Missing: {record.gapMissing.join(', ') || '—'}</p>
        {record.estimatedFigures.length > 0 && (
          <p className="hint">Estimated figures sent: {record.estimatedFigures.join(', ')}</p>
        )}
      </section>

      <section>
        <h3>The posting</h3>
        <pre className="dash-jd">{record.jobDescription || 'Not captured.'}</pre>
      </section>
    </article>
  );
}
