import { useEffect, useRef, useState } from 'react';
import type { Profile } from '@/lib/schema';
import type { LlmSettings } from '@/lib/settings';
import { extractResumeText } from '@/lib/resume-text';
import { parseResume, parseResumeHeuristic, type ParsedResume } from '@/lib/resume-parser';
import { snapshotProfile } from '@/lib/storage';

type ImportState =
  | { kind: 'idle' }
  /**
   * `heuristic` is what was read without any model, held so the AI pass can be
   * abandoned at any moment and still leave a usable import. Before this the
   * screen said "Pulling out your details with AI…" and offered nothing else:
   * on a free model pool that wait can run to minutes across several attempts,
   * and there was no elapsed time, no way to stop, and nothing to show for the
   * contact details and links that had already been read perfectly well.
   */
  | { kind: 'working'; note: string; heuristic?: ParsedResume; fileName?: string; startedAt?: number }
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
  certifications: boolean;
  summaryAndSkills: boolean;
}

/**
 * How long this has been going, ticking every second.
 *
 * Free endpoints are shared and slow, and the extension tries more than one of
 * them before giving up — so a genuinely working import can sit for a minute
 * or more. Without a number moving on screen there is no way to tell that from
 * a hang, which is exactly how it was read.
 */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return (
    <span className="hint mono" aria-hidden="true">
      {seconds}s
    </span>
  );
}

function countFound(parsed: ParsedResume) {
  return {
    contact: Object.values(parsed.contact).filter(Boolean).length,
    links: Object.values(parsed.links).filter(Boolean).length,
    workHistory: parsed.workHistory.length,
    education: parsed.education.length,
    projects: parsed.projects.length,
    certifications: parsed.certifications.length,
    summaryAndSkills: (parsed.summary ? 1 : 0) + parsed.skills.length,
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
  if (selection.certifications && parsed.certifications.length) {
    next.certifications = parsed.certifications;
  }
  // Never over the top of something typed. These two were recognised on the
  // page and then discarded, which is why a tailored resume came out with no
  // summary and no skills line — but a user who has written their own summary
  // should not lose it to an import.
  if (selection.summaryAndSkills) {
    if (parsed.summary && !profile.summary.trim()) next.summary = parsed.summary;
    if (parsed.skills.length > 0 && profile.skills.length === 0) next.skills = parsed.skills;
  }

  return next;
}

const SECTION_LABELS: Array<{ key: keyof Selection; label: string; unit: string }> = [
  { key: 'contact', label: 'Contact details', unit: 'field' },
  { key: 'links', label: 'Links', unit: 'link' },
  { key: 'workHistory', label: 'Work history', unit: 'role' },
  { key: 'education', label: 'Education', unit: 'entry' },
  { key: 'projects', label: 'Projects', unit: 'project' },
  { key: 'certifications', label: 'Certifications', unit: 'certificate' },
  { key: 'summaryAndSkills', label: 'Summary and skills', unit: 'item' },
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
    certifications: true,
    summaryAndSkills: true,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Distinguishes a finished run from one the user walked away from. */
  const runId = useRef(0);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setState({ kind: 'working', note: `Reading ${file.name}…` });
    const run = ++runId.current;

    try {
      const text = await extractResumeText(file);

      // Read without a model first. It costs nothing, it is where contact
      // details and links come from anyway, and having it in hand is what
      // makes the AI pass optional rather than a wait with no way out.
      const heuristic = parseResumeHeuristic(text);
      if (!llm.backend) {
        setState({ kind: 'review', parsed: heuristic, fileName: file.name });
        return;
      }

      setState({
        kind: 'working',
        note: 'Pulling out your details with AI…',
        heuristic,
        fileName: file.name,
        startedAt: Date.now(),
      });

      const outcome = await parseResume(text, llm);
      // Skipped or superseded while the model was working: whatever is on
      // screen now is the user's choice, and this answer is no longer wanted.
      if (run !== runId.current) return;

      setState({
        kind: 'review',
        parsed: outcome.parsed,
        fileName: file.name,
        aiError: outcome.ai === 'failed' ? outcome.aiError : undefined,
      });
    } catch (err) {
      if (run !== runId.current) return;
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not read that file.' });
    }
  };

  /** Takes what was read without a model and stops waiting for the rest. */
  const skipAi = () => {
    if (state.kind !== 'working' || !state.heuristic) return;
    runId.current += 1;
    setState({
      kind: 'review',
      parsed: state.heuristic,
      fileName: state.fileName ?? 'your resume',
      aiError: 'Skipped — this is what was read without the model.',
    });
  };

  const handleApply = async () => {
    if (state.kind !== 'review') return;
    const counts = countFound(state.parsed);
    const kept = SECTION_LABELS.filter((s) => selection[s.key] && counts[s.key] > 0);
    // Importing overwrites whole sections; keep a way back.
    await snapshotProfile('before importing a resume');
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
          <p className="hint mt-2 mb-0">
            PDF, Word (.docx), or plain text.
          </p>
        </>
      )}

      {state.kind === 'working' && (
        <div className="status-row mt-3">
          <span className="pill pill-neutral">{state.note}</span>
          {/* Elapsed, because a pill that never changes is indistinguishable
              from one that has hung — and on a free pool this genuinely takes
              a while, across more than one model. */}
          {state.startedAt !== undefined && <Elapsed since={state.startedAt} />}
          {state.heuristic && (
            <button type="button" className="btn-plain" onClick={skipAi}>
              Skip and use what was read
            </button>
          )}
        </div>
      )}
      {state.kind === 'error' && (
        <p className="status-row mt-3">
          <span className="pill pill-danger">{state.message}</span>
        </p>
      )}
      {state.kind === 'applied' && (
        <p className="status-row mt-3">
          <span className="pill pill-success">{state.summary}</span>
        </p>
      )}

      {state.kind === 'review' && (
        <div className="import-review">
          <p className="hint mb-3">
            Found in <strong>{state.fileName}</strong>. Untick anything you would rather fill in yourself.
          </p>
          {state.aiError && (
            <p className="status-row mb-3">
              <span className="pill pill-warning">
                AI pass failed, so this is pattern matching only — {state.aiError}
              </span>
            </p>
          )}

          {SECTION_LABELS.map(({ key, label, unit }) => {
            const found = countFound(state.parsed)[key];
            // Summary and skills never replace what is already there, so
            // there is nothing to warn about overwriting.
            const existing =
              key === 'contact' || key === 'links' || key === 'summaryAndSkills'
                ? 0
                : (profile[key] as unknown[]).length;
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

          <div className="actions mt-3">
            <button type="button" className="btn" onClick={() => setState({ kind: 'idle' })}>
              Discard
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handleApply()}>
              Use these details
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
