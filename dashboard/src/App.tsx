import { useEffect, useState } from 'react';
import { askExtension, NoExtensionError, wordingOutcomes, type TransferableRecord } from './bridge';
import { ApplicationList } from './ApplicationList';
import { ApplicationDetail } from './ApplicationDetail';

export function App() {
  const [records, setRecords] = useState<TransferableRecord[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    askExtension({ type: 'list' })
      .then((response) => {
        if (response.ok && response.records) setRecords(response.records);
        else setError('ApplyFlow refused the request.');
      })
      .catch((err) => setError(err instanceof NoExtensionError ? err.message : 'Could not reach ApplyFlow.'));
  };

  useEffect(refresh, []);

  if (error) {
    return (
      <main className="dash">
        <h1>ApplyFlow</h1>
        <p className="error">{error}</p>
        <p className="hint">
          This page holds nothing of its own. Every application it shows lives in the extension on your machine,
          so it needs ApplyFlow installed in this browser to show you anything.
        </p>
      </main>
    );
  }

  if (!records) return <main className="dash"><p className="hint">Reading your applications…</p></main>;

  return (
    <main className="dash">
      <h1>Applications</h1>
      {selected ? (
        <ApplicationDetail id={selected} onBack={() => setSelected(null)} onChanged={refresh} />
      ) : (
        <>
          <ApplicationList records={records} onOpen={setSelected} />
          <Wording records={records} />
        </>
      )}
    </main>
  );
}

/**
 * Which resume wording gets answered — the question the whole record exists
 * to answer, and one no count of filled fields could ever reach.
 *
 * The ids are the bank's own, shown raw: resolving them to the bullet text
 * would need the bank, which lives in the extension and is not part of this
 * page's protocol.
 */
function Wording({ records }: { records: TransferableRecord[] }) {
  const outcomes = wordingOutcomes(records);
  if (outcomes.length === 0) return null;

  return (
    <section className="dash-wording">
      <h2>Wording that gets replies</h2>
      <p className="hint">
        Each bullet variant that has gone out, and how often the application came back. Meaningful once the
        same bullet has been sent a few times.
      </p>
      <table className="dash-table dash-table-static">
        <thead>
          <tr>
            <th>Bullet variant</th>
            <th>Sent</th>
            <th>Replied</th>
            <th>Rate</th>
          </tr>
        </thead>
        <tbody>
          {outcomes.map((o) => (
            <tr key={o.variantId}>
              <td><code>{o.variantId}</code></td>
              <td>{o.sent}</td>
              <td>{o.replied}</td>
              <td>{Math.round((o.replied / o.sent) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
