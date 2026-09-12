import { useEffect, useState } from 'react';
import { getDocumentsFolderHandle, saveDocumentsFolderHandle, supportsDocumentsFolder } from '@/lib/document-store';
import type { LlmSettings } from '@/lib/settings';
import { ModelPicker } from './ModelPicker';
import { PROVIDERS, originPatternFor, providerById } from '@/lib/providers';
import { TextField } from '@/components/fields';

/**
 * Everything that reaches outside the extension: the documents folder and the
 * AI backend.
 */

export function DocumentsSection() {
  // Chromium-only. Rendering the button on a browser that cannot honour it
  // makes the feature look broken rather than unavailable.
  const supported = supportsDocumentsFolder();
  const [folderName, setFolderName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getDocumentsFolderHandle()
      .then((handle) => setFolderName(handle?.name ?? null))
      .finally(() => setLoaded(true));
  }, []);

  const handleGrant = async () => {
    setError(null);
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      await saveDocumentsFolderHandle(handle);
      setFolderName(handle.name);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError('Could not access that folder.');
      }
    }
  };

  if (!supported) {
    return (
      <section>
        <h2>Documents</h2>
        <p className="hint">
          Linking a documents folder needs the File System Access API, which this browser does not support — it is
          currently Chromium-only (Chrome, Brave, Edge). Everything else works as normal; you will just attach
          resumes and cover letters by hand.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2>Documents</h2>
      <p className="hint">
        Grant access to the folder where your tailored resumes and cover letters are saved (e.g. your Desktop{'/'}
        jobs folder). Name files so they include the company and "resume"/"cv" or "cover letter" (e.g. "Acme Corp
        - Resume.pdf") so the extension can find the right one when it hits a file-upload field.
      </p>
      {loaded && (
        <p>{folderName ? <>Linked folder: <strong>{folderName}</strong></> : 'No folder linked yet.'}</p>
      )}
      <button type="button" className="btn" onClick={handleGrant}>
        {folderName ? 'Change folder' : 'Grant folder access'}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

export function LlmSettingsSection({
  value,
  onChange,
}: {
  value: LlmSettings;
  onChange: (value: LlmSettings) => void;
}) {
  const llm = value;
  const setLlm = onChange;
  const provider = providerById(llm.provider);
  const [hostGranted, setHostGranted] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Editing any of it invalidates a result that described the old settings.
  const update = (patch: Partial<LlmSettings>) => {
    setTestResult(null);
    setLlm({ ...llm, ...patch });
  };

  // MV3 will not let an extension call an arbitrary host without a grant, and
  // the grant has to be asked for from a click.
  const grantHost = async () => {
    const origin = originPatternFor(llm.baseUrl);
    if (!origin) {
      setHostGranted(false);
      return;
    }
    try {
      setHostGranted(await browser.permissions.request({ origins: [origin] }));
    } catch {
      setHostGranted(false);
    }
  };

  const runTest = async () => {
    if (!llm.backend) return;
    setTesting(true);
    try {
      const { testLlmConnection } = await import('@/lib/llm-client');
      const result = await testLlmConnection(llm, llm.backend);
      setTestResult(
        result.ok ? { ok: true, message: 'The model answered. Drafting is ready.' } : { ok: false, message: result.message }
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <section>
      <h2>AI answer drafting</h2>
      <p className="hint">
        Optional. Drafts answers to open-ended questions using your work history and projects. Drafts are always
        shown to you to edit — nothing is entered automatically.
      </p>
      <label className="field">
        <span>Where should drafting run?</span>
        <select
          value={llm.backend ? llm.provider : ''}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) {
              update({ backend: null });
              return;
            }
            const spec = providerById(id);
            update({
              // `backend` still drives whether drafting is on at all, and which
              // dialect the fallback uses.
              backend: spec.dialect === 'ollama' ? 'ollama' : 'openrouter',
              provider: id,
              baseUrl: spec.baseUrl,
              modelPolicy:
                id === 'openrouter'
                  ? { kind: 'free-pool', minContext: 32_000 }
                  : { kind: 'single', model: spec.defaultModel },
            });
          }}
        >
          <option value="">Off</option>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {llm.backend && provider.note && (
        <p className="hint mt-3">
          {provider.note}
        </p>
      )}

      {llm.backend && provider.id === 'custom' && (
        <>
          <label className="field mt-3">
            <span>Base URL</span>
            <input
              type="text"
              placeholder="https://api.example.com/v1"
              value={llm.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
            />
          </label>
          <button type="button" className="btn mt-2" onClick={grantHost}>
            {hostGranted === true ? 'Access granted' : 'Allow access to this host'}
          </button>
          {hostGranted === false && (
            <p className="error mt-2">
              Without permission for that host, requests to it will fail.
            </p>
          )}
        </>
      )}

      {llm.backend && provider.needsKey && (
        <label className="field mt-3">
          <span>API key</span>
          <input
            type="password"
            value={llm.apiKeys[provider.id] ?? ''}
            onChange={(e) => update({ apiKeys: { ...llm.apiKeys, [provider.id]: e.target.value } })}
          />
        </label>
      )}
      {llm.backend && provider.id === 'anthropic' && (
        <>
          <label className="field mt-3">
            <span>Workspace ID</span>
            <input
              type="text"
              placeholder="Only needed for an identity-linked key"
              value={llm.anthropicWorkspaceId}
              onChange={(e) => update({ anthropicWorkspaceId: e.target.value })}
            />
          </label>
          <p className="hint">
            Leave empty unless Anthropic asks for it. A key tied to your identity rather than to one workspace
            needs to say which workspace a request is for — find the id in the Console under Settings → Workspaces.
          </p>
        </>
      )}

      {llm.backend && provider.keyUrl && (
        <p className="hint">
          Get a key from{' '}
          <a href={provider.keyUrl} target="_blank" rel="noreferrer">
            {provider.keyUrl.replace(/^https:\/\//, '')}
          </a>
          . It is stored on this computer and sent only to {provider.label}.
        </p>
      )}

      {llm.backend === 'ollama' && (
        <>
          <p className="hint mt-3 mb-3">
            Requires <a href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a> running locally with a
            model pulled. Nothing leaves your computer.
          </p>
          <TextField label="Model" value={llm.ollamaModel} onChange={(v) => update({ ollamaModel: v })} />
        </>
      )}

      {llm.backend === 'openrouter' && provider.id === 'openrouter' && (
        <>
          <p className="hint">
            A small, cheap model is enough here — this is mostly pulling structure out of text and writing a first
            draft you then edit. Models ending in <code>:free</code> cost nothing, but usually come with no
            data-retention guarantee and tight daily limits; since the text sent includes your resume and work
            history, prefer a cheap paid model, or use Ollama to keep everything on your machine.
          </p>
          <ModelPicker policy={llm.modelPolicy} onChange={(modelPolicy) => update({ modelPolicy })} />
        </>
      )}

      {/* Providers that serve their own models take a plain model id; only
          OpenRouter has a public catalogue worth browsing in-app. */}
      {llm.backend && provider.dialect !== "ollama" && provider.id !== "openrouter" && (
        <>
          <TextField
            label="Model"
            value={llm.modelPolicy.kind === "single" ? llm.modelPolicy.model : ""}
            onChange={(v) => update({ modelPolicy: { kind: "single", model: v } })}
          />
          <p className="hint">
            The model id exactly as {provider.label} writes it
            {provider.defaultModel ? `, for example "${provider.defaultModel}"` : ''}.
          </p>
        </>
      )}

      {llm.backend && (
        <>
          <button type="button" className="btn mt-3" disabled={testing} onClick={runTest}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {testResult && (
            <p className="status-row mt-2">
              <span className={`pill ${testResult.ok ? 'pill-success' : 'pill-danger'}`}>
                {testResult.ok ? 'Working' : 'Failed'}
              </span>
            </p>
          )}
          {testResult && !testResult.ok && <p className="error mt-2">{testResult.message}</p>}

          <label className="field mt-3">
            <span>If that fails, fall back to</span>
            <select
              value={llm.fallbackBackend ?? ''}
              onChange={(e) =>
                setLlm({ ...llm, fallbackBackend: (e.target.value || null) as LlmSettings['fallbackBackend'] })
              }
            >
              <option value="">Nothing — report the failure</option>
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Ollama, if it is running</option>
            </select>
          </label>
          {llm.fallbackBackend === llm.backend ? (
            <p className="hint mt-2">
              That is the same as the primary, so it cannot help. Pick the other one, or none.
            </p>
          ) : (
            llm.fallbackBackend && (
              <p className="hint mt-2">
                Used when the primary is rate-limited, offline, or slow. Its model and key need filling in too —
                switch the dropdown above to configure it, then switch back.
              </p>
            )
          )}
        </>
      )}
    </section>
  );
}
