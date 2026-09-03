import { useEffect, useState } from 'react';
import { ageInDays, getBank, missingSources, type BulletBank } from '@/lib/bullet-bank';
import { bankScore, sourcesFrom } from '@/lib/bank-generation';
import { getBankRun, type BankRunState } from '@/lib/bank-run';
import type { StartBankMessage } from '@/entrypoints/background';
import { getProfile } from '@/lib/storage';
import type { Profile } from '@/lib/schema';

/**
 * Generating and reviewing the bullet bank.
 *
 * The inferred target families are shown for approval before anything is
 * generated: a wrong guess biases the vocabulary of every variant, and that is
 * expensive to find out after several hundred exist.
 */
export function BankSection() {
  const [bank, setBank] = useState<BulletBank | null>(null);
  const [run, setRun] = useState<BankRunState | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const refresh = () => {
      void getBank().then(setBank);
      void getBankRun().then(setRun);
      void getProfile().then(setProfile);
    };
    refresh();
    // Generation runs in the worker and writes progress to storage, so this is
    // how the panel follows it without polling.
    browser.storage.local.onChanged.addListener(refresh);
    return () => browser.storage.local.onChanged.removeListener(refresh);
  }, []);

  const start = async (families?: BankRunState['families']) => {
    setStarting(true);
    try {
      await browser.runtime.sendMessage({ type: 'start-bank', families } satisfies StartBankMessage);
    } finally {
      setStarting(false);
    }
  };

  const sources = profile ? sourcesFrom(profile) : [];
  const uncovered = missingSources(bank, sources.map((s) => s.id));
  const running = run?.status === 'inferring' || run?.status === 'generating';

  return (
    <section>
      <h2>Tailoring bank</h2>
      <p className="hint">
        Several ways of describing each thing you have done, written once. Applying to a job then picks the ones
        that fit rather than writing anything new — which is what keeps a tailored resume in your own words.
      </p>

      {run?.status === 'error' && <p className="error">{run.message}</p>}

      {running && (
        <div className="notice notice-warning">
          <p>
            {run.status === 'inferring'
              ? 'Working out which kinds of role your experience suits…'
              : `Writing variants for ${run.current ?? 'your experience'} — ${run.done} of ${run.total} done.`}
          </p>
          <p className="hint">This keeps going if you close the panel.</p>
        </div>
      )}

      {!running && run?.families && run.families.length > 0 && (
        <div className="bank-families">
          <p className="hint">Generated for these kinds of role:</p>
          <p className="status-row">
            {run.families.map((family) => (
              <span key={family.name} className="pill pill-neutral">
                {family.name}
              </span>
            ))}
          </p>
        </div>
      )}

      {bank && (
        <p className="status-row" style={{ marginTop: 10 }}>
          <span className="pill pill-success">{bank.variants.length} variants</span>
          <span className={`pill ${bankScore(bank.variants) >= 80 ? 'pill-success' : 'pill-warning'}`}>
            {bankScore(bank.variants)}/100
          </span>
          <span className="hint" style={{ marginLeft: 8 }}>
            {ageInDays(bank) === 0 ? 'generated today' : `generated ${ageInDays(bank)} days ago`}
          </span>
        </p>
      )}

      {!running && bank && uncovered.length > 0 && (
        <div className="notice notice-warning" style={{ marginTop: 10 }}>
          <p>
            {uncovered.length} {uncovered.length === 1 ? 'item is' : 'items are'} not in the bank yet, so tailoring
            cannot use {uncovered.length === 1 ? 'it' : 'them'}. Regenerate to include{' '}
            {uncovered.length === 1 ? 'it' : 'them'}.
          </p>
        </div>
      )}

      {!running && run?.needMetrics && run.needMetrics.length > 0 && (
        <div className="notice notice-warning" style={{ marginTop: 10 }}>
          <p>
            Nothing measurable in: <strong>{run.needMetrics.map((s) => s.label).join(', ')}</strong>. A number is the
            one thing a model cannot supply for you — add one to those achievements and regenerate, and every future
            application improves.
          </p>
        </div>
      )}

      {sources.length === 0 && (
        <p className="hint">Add achievements to a role or project first — there is nothing to write variants of yet.</p>
      )}

      <button
        type="button"
        className="btn btn-primary"
        style={{ marginTop: 12 }}
        disabled={running || starting || sources.length === 0}
        onClick={() => void start()}
      >
        {running ? 'Generating…' : bank ? 'Regenerate bank' : 'Generate bank'}
      </button>
    </section>
  );
}
