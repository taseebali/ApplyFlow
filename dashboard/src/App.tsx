import { useEffect, useState } from 'react';
import { askExtension, NoExtensionError, type TransferableRecord } from './bridge';
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
        <ApplicationList records={records} onOpen={setSelected} />
      )}
    </main>
  );
}
