import { useEffect, useState } from 'react';
import { ageInDays, getBank, missingSources, type BulletBank } from '@/lib/bullet-bank';
import { bankScore, sourcesFrom, sourcesMissingMetrics } from '@/lib/bank-generation';
import { getBankRun, type BankRunState } from '@/lib/bank-run';
import type { StartBankMessage } from '@/entrypoints/background';
import { type Profile } from '@/lib/schema';
import { askForMetrics, fallbackQuestion, type EnrichmentQuestion } from '@/lib/enrichment';
import { getSettings } from '@/lib/settings';
import { getProfile, setProfile } from '@/lib/storage';

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
  const [questions, setQuestions] = useState<EnrichmentQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);

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
  const missingMetrics = sourcesMissingMetrics(sources);

  /**
   * A number is the one thing generation cannot supply, so it is asked for
   * rather than invented — once, here, not once per application.
   */
  const ask = async () => {
    setAsking(true);
    try {
      const settings = await getSettings();
      setQuestions(
        settings.llm.backend
          ? await askForMetrics(missingMetrics, settings.llm)
          : missingMetrics.map((source) => ({
              sourceId: source.id,
              label: source.label,
              question: fallbackQuestion(source),
            }))
      );
    } finally {
      setAsking(false);
    }
  };

  /**
   * Answers become the user's own bullets, then that item is regenerated so
   * every framing of it can use the number.
   */
  const saveAnswers = async () => {
    if (!profile) return;
    const answered = Object.entries(answers).filter(([, text]) => text.trim().length > 0);
    if (answered.length === 0) return;

    const byId = new Map(answered);
    const next: Profile = {
      ...profile,
      workHistory: profile.workHistory.map((role) =>
        byId.has(role.id)
          ? { ...role, bullets: [...role.bullets, { id: crypto.randomUUID(), text: byId.get(role.id)!.trim() }] }
          : role
      ),
      projects: profile.projects.map((project) =>
        byId.has(project.id)
          ? {
              ...project,
              bullets: [...project.bullets, { id: crypto.randomUUID(), text: byId.get(project.id)!.trim() }],
            }
          : project
      ),
    };

    await setProfile(next);
    setQuestions(null);
    setAnswers({});
    await browser.runtime.sendMessage({
      type: 'start-bank',
      onlySourceIds: answered.map(([id]) => id),
    } satisfies StartBankMessage);
  };
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

      {!running && missingMetrics.length > 0 && !questions && (
        <div className="notice notice-warning" style={{ marginTop: 10 }}>
          <p>
            Nothing measurable in: <strong>{missingMetrics.map((s) => s.label).join(', ')}</strong>. A number is the
            one thing generation cannot supply for you, and it is what separates a strong bullet from a vague one.
          </p>
          <button type="button" className="btn" disabled={asking} onClick={() => void ask()}>
            {asking ? 'Thinking of questions…' : `Answer ${missingMetrics.length} quick question${missingMetrics.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {questions && questions.length > 0 && (
        <div className="enrichment">
          {questions.map((q) => (
            <label className="field" key={q.sourceId}>
              <span>{q.label}</span>
              <p className="hint">{q.question}</p>
              <textarea
                rows={2}
                value={answers[q.sourceId] ?? ''}
                placeholder="About 500 documents; lookup went from minutes to seconds."
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.sourceId]: e.target.value }))}
              />
            </label>
          ))}
          <div className="tailor-actions">
            <button type="button" className="btn" onClick={() => setQuestions(null)}>
              Not now
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void saveAnswers()}>
              Save and regenerate those
            </button>
          </div>
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
