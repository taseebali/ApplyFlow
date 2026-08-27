import { useRef, useState } from 'react';
import type { Profile } from '@/lib/schema';
import type { LlmSettings } from '@/lib/settings';
import { extractResumeText } from '@/lib/resume-text';
import { parseResume, type ParsedResume } from '@/lib/resume-parser';

type ImportState =
  | { kind: 'idle' }
  | { kind: 'working'; note: string }
  | { kind: 'error'; message: string }
  | { kind: 'review'; parsed: ParsedResume; fileName: string; aiError?: string }
  | { kind: 'applied'; summary: string };

/** Which parts of a parsed resume the user has chosen to keep. */
interface Selection {
  contact: boolean;
  links: boolean;
  workHistory: boolean;
  education: boolean;
  projects: boolean;
}

function countFound(parsed: ParsedResume) {
  return {
    contact: Object.values(parsed.contact).filter(Boolean).length,
    links: Object.values(parsed.links).filter(Boolean).length,
    workHistory: parsed.workHistory.length,
    education: parsed.education.length,
    projects: parsed.projects.length,
  };
}

/**
 * Applies only the sections the user ticked. Contact and links are merged
 * field-by-field so a value the resume did not mention never blanks something
 * already saved; the list sections replace wholesale, which is why the review
 * screen warns when they would overwrite existing entries.
 */
function applyParsed(profile: Profile, parsed: ParsedResume, selection: Selection): Profile {
  const next: Profile = { ...profile };

  if (selection.contact) {
    next.contact = { ...profile.contact };
    for (const [key, value] of Object.entries(parsed.contact)) {
      if (value) (next.contact as Record<string, string>)[key] = value;
    }
  }
  if (selection.links) {
    next.links = { ...profile.links };
    for (const [key, value] of Object.entries(parsed.links)) {
      if (value) (next.links as Record<string, string>)[key] = value;
    }
  }
  if (selection.workHistory && parsed.workHistory.length) next.workHistory = parsed.workHistory;
  if (selection.education && parsed.education.length) next.education = parsed.education;
  if (selection.projects && parsed.projects.length) next.projects = parsed.projects;

  return next;
}

const SECTION_LABELS: Array<{ key: keyof Selection; label: string; unit: string }> = [
  { key: 'contact', label: 'Contact details', unit: 'field' },
  { key: 'links', label: 'Links', unit: 'link' },
  { key: 'workHistory', label: 'Work history', unit: 'role' },
  { key: 'education', label: 'Education', unit: 'entry' },
  { key: 'projects', label: 'Projects', unit: 'project' },
];

export function ResumeImportSection({
  profile,
  onChange,
  llm,
}: {
  profile: Profile;
  onChange: (p: Profile) => void;
  llm: LlmSettings;
}) {
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  const [selection, setSelection] = useState<Selection>({
    contact: true,
    links: true,
    workHistory: true,
    education: true,
    projects: true,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setState({ kind: 'working', note: `Reading ${file.name}…` });
    try {
      const text = await extractResumeText(file);
      setState({
        kind: 'working',
        note: llm.backend ? 'Pulling out your details with AI…' : 'Pulling out your details…',
      });
      const outcome = await parseResume(text, llm);
      setState({
        kind: 'review',
        parsed: outcome.parsed,
        fileName: file.name,
        aiError: outcome.ai === 'failed' ? outcome.aiError : undefined,
      });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not read that file.' });
    }
  };

  const handleApply = () => {
    if (state.kind !== 'review') return;
    const counts = countFound(state.parsed);
    const kept = SECTION_LABELS.filter((s) => selection[s.key] && counts[s.key] > 0);
    onChange(applyParsed(profile, state.parsed, selection));
    setState({
      kind: 'applied',
      summary: kept.length
        ? `Filled in ${kept.map((s) => s.label.toLowerCase()).join(', ')}. Check the next steps and correct anything that looks off.`
        : 'Nothing was selected, so your profile is unchanged.',
    });
  };

  return (
    <section>
      <h2>Start from your resume</h2>
      <p className="hint">
        Import a resume and ApplyFlow fills in what it can, so the rest of setup is a quick check rather than a lot
        of typing. Nothing is saved until you review it.{' '}
        {llm.backend
          ? 'Work history and projects are read using the AI backend you set up.'
          : 'Contact details and links import without any AI. Set up AI drafting later to also pull in work history and projects.'}
      </p>

      {state.kind !== 'review' && (
        <>
          <button
            type="button"
            className="btn"
            disabled={state.kind === 'working'}
            onClick={() => fileInputRef.current?.click()}
          >
            {state.kind === 'working' ? 'Working…' : 'Choose resume file'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            style={{ display: 'none' }}
            onChange={handleFile}
          />
          <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
            PDF, Word (.docx), or plain text.
          </p>
        </>
      )}

      {state.kind === 'working' && (
        <p className="status-row" style={{ marginTop: 10 }}>
          <span className="pill pill-neutral">{state.note}</span>
        </p>
      )}
      {state.kind === 'error' && (
        <p className="status-row" style={{ marginTop: 10 }}>
          <span className="pill pill-danger">{state.message}</span>
        </p>
      )}
      {state.kind === 'applied' && (
        <p className="status-row" style={{ marginTop: 10 }}>
          <span className="pill pill-success">{state.summary}</span>
        </p>
      )}

      {state.kind === 'review' && (
        <div className="import-review">
          <p className="hint" style={{ marginBottom: 10 }}>
            Found in <strong>{state.fileName}</strong>. Untick anything you would rather fill in yourself.
          </p>
          {state.aiError && (
            <p className="status-row" style={{ marginBottom: 10 }}>
              <span className="pill pill-warning">
                AI pass failed, so this is pattern matching only — {state.aiError}
              </span>
            </p>
          )}

          {SECTION_LABELS.map(({ key, label, unit }) => {
            const found = countFound(state.parsed)[key];
            const existing =
              key === 'contact' || key === 'links' ? 0 : (profile[key] as unknown[]).length;
            return (
              <label className="field checkbox import-row" key={key}>
                <input
                  type="checkbox"
                  checked={selection[key] && found > 0}
                  disabled={found === 0}
                  onChange={(e) => setSelection({ ...selection, [key]: e.target.checked })}
                />
                <span>
                  {label} —{' '}
                  {found === 0 ? (
                    <span className="pill pill-neutral">nothing found</span>
                  ) : (
                    <>
                      {found} {unit}
                      {found === 1 ? '' : 's'}
                      {existing > 0 && selection[key] && (
                        <>
                          {' '}
                          <span className="pill pill-warning">replaces {existing}</span>
                        </>
                      )}
                    </>
                  )}
                </span>
              </label>
            );
          })}

          <div className="import-actions">
            <button type="button" className="btn" onClick={() => setState({ kind: 'idle' })}>
              Discard
            </button>
            <button type="button" className="btn btn-primary" onClick={handleApply}>
              Use these details
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
