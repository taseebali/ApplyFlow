import { useEffect, useMemo, useState } from 'react';
import { fetchModelHealth, getModels, type CatalogModel, type ModelHealth } from '@/lib/openrouter-catalog';
import type { ModelPolicy } from '@/lib/model-router';

/** Per million tokens, which is how OpenRouter's own pricing is quoted. */
function priceLabel(model: CatalogModel): string {
  if (model.isFree) return 'free';
  const perMillion = model.promptPrice * 1_000_000;
  return perMillion < 1 ? `$${perMillion.toFixed(2)}/M` : `$${perMillion.toFixed(1)}/M`;
}

function contextLabel(model: CatalogModel): string {
  if (!model.contextLength) return '';
  return model.contextLength >= 1000 ? `${Math.round(model.contextLength / 1000)}k ctx` : `${model.contextLength} ctx`;
}

function HealthNote({ health }: { health: ModelHealth | null }) {
  if (!health) return null;
  if (!health.anyLive) {
    return (
      <p className="error" style={{ marginTop: 8 }}>
        No provider is currently serving this model. It has probably been retired — pick another one.
      </p>
    );
  }
  const uptime = health.bestUptime5m;
  const tone = uptime === null ? 'pill-neutral' : uptime >= 95 ? 'pill-success' : uptime >= 60 ? 'pill-warning' : 'pill-danger';
  return (
    <p className="status-row" style={{ marginTop: 8 }}>
      <span className={`pill ${tone}`}>
        {uptime === null ? 'live' : `${Math.round(uptime)}% uptime`}
      </span>
      <span className="hint" style={{ marginLeft: 8 }}>
        {health.providers.join(', ')}
      </span>
    </p>
  );
}

/**
 * Chooses how a model is picked. Replaces pasting an id from the website: the
 * free roster changes often enough that a pasted id can be dead on arrival,
 * and it fails in a way that looks like every other error.
 */
export function ModelPicker({ policy, onChange }: { policy: ModelPolicy; onChange: (p: ModelPolicy) => void }) {
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [freeOnly, setFreeOnly] = useState(true);
  const [health, setHealth] = useState<ModelHealth | null>(null);

  const load = async (force = false) => {
    setLoading(true);
    setLoadError(null);
    try {
      setModels(await getModels({ force }));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the model list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected = policy.kind === 'single' ? policy.model : '';

  // Only for the model actually chosen: asking for all of them would be
  // hundreds of requests.
  useEffect(() => {
    setHealth(null);
    if (!selected) return;
    let cancelled = false;
    void fetchModelHealth(selected).then((result) => {
      if (!cancelled) setHealth(result);
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return models
      .filter((m) => (freeOnly ? m.isFree : true))
      .filter((m) => !needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
      .sort((a, b) => b.contextLength - a.contextLength)
      .slice(0, 60);
  }, [models, filter, freeOnly]);

  const freeCount = models.filter((m) => m.isFree).length;

  return (
    <div>
      <label className="field" style={{ marginTop: 12 }}>
        <span>How should a model be chosen?</span>
        <select
          value={policy.kind}
          onChange={(e) => {
            const kind = e.target.value as ModelPolicy['kind'];
            if (kind === 'free-pool') onChange({ kind: 'free-pool', minContext: 32_000 });
            else if (kind === 'single') onChange({ kind: 'single', model: selected });
            else onChange({ kind: 'list', models: selected ? [selected] : [] });
          }}
        >
          <option value="free-pool">Any free model (rotates when one is busy)</option>
          <option value="single">One model I choose</option>
          <option value="list">An ordered list I choose</option>
        </select>
      </label>

      {policy.kind === 'free-pool' && (
        <>
          <div className="notice notice-warning" style={{ marginTop: 10 }}>
            <p>
              Free models are served by providers that may <strong>train on what is sent</strong> — which here
              includes your resume, work history, and the answers drafted from them. Choose a paid model or Ollama
              if that matters to you.
            </p>
          </div>
          <label className="field" style={{ marginTop: 10 }}>
            <span>Smallest context to accept</span>
            <select
              value={policy.minContext}
              onChange={(e) => onChange({ kind: 'free-pool', minContext: Number(e.target.value) })}
            >
              <option value={8_000}>8k — most models qualify</option>
              <option value={32_000}>32k — enough for a full resume</option>
              <option value={128_000}>128k — long job descriptions too</option>
            </select>
          </label>
          <p className="hint">
            {loading
              ? 'Loading the model list…'
              : `${freeCount} free model${freeCount === 1 ? '' : 's'} available right now.`}
          </p>
        </>
      )}

      {policy.kind !== 'free-pool' && (
        <>
          <div className="grid" style={{ marginTop: 10 }}>
            <label className="field">
              <span>Search models</span>
              <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="gemini, llama…" />
            </label>
            <label className="field checkbox" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
              <span>Free only</span>
            </label>
          </div>

          {loading && <p className="hint">Loading the model list…</p>}
          {loadError && <p className="error">{loadError}</p>}

          <label className="field" style={{ marginTop: 10 }}>
            <span>{policy.kind === 'single' ? 'Model' : 'Add a model'}</span>
            <select
              value={policy.kind === 'single' ? policy.model : ''}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                if (policy.kind === 'single') onChange({ kind: 'single', model: id });
                else if (!policy.models.includes(id)) onChange({ kind: 'list', models: [...policy.models, id] });
              }}
            >
              <option value="">{visible.length ? 'Choose a model…' : 'No models match'}</option>
              {/* A saved id the catalogue no longer lists must stay visible. */}
              {policy.kind === 'single' && policy.model && !visible.some((m) => m.id === policy.model) && (
                <option value={policy.model}>{policy.model} (not in the current list)</option>
              )}
              {visible.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {[priceLabel(m), contextLabel(m)].filter(Boolean).join(', ')}
                </option>
              ))}
            </select>
          </label>

          {policy.kind === 'single' && <HealthNote health={health} />}

          {policy.kind === 'list' && (
            <div className="doc-results" style={{ marginTop: 10 }}>
              {policy.models.length === 0 && <p className="hint">No models chosen yet.</p>}
              {policy.models.map((id, i) => (
                <div className="doc-row" key={id}>
                  <span className="doc-row-label" title={id}>
                    {i + 1}. {id}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onChange({ kind: 'list', models: policy.models.filter((m) => m !== id) })}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <button type="button" className="btn" style={{ marginTop: 10 }} disabled={loading} onClick={() => void load(true)}>
        {loading ? 'Refreshing…' : 'Refresh model list'}
      </button>
    </div>
  );
}
