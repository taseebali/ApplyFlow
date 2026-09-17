/**
 * One application, in full.
 *
 * A panel over the list rather than a separate page: the list is the context
 * for what is being read, and losing it to a back button is what made the old
 * detail view feel like a different place.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowSquareOut, FileArrowDown, X } from '@phosphor-icons/react';
import {
  askExtension,
  toBlobUrl,
  type DetailedRecord,
  type EditableProperties,
} from './bridge';
import { Properties } from './Properties';
import { RelativeDate } from './ui';

/*
 * Object URLs are memoised on the base64 they were built from, otherwise every
 * re-render (a property change, a parent refresh) would leak another one — blob
 * URLs are never freed on their own. The cleanup below closes over this
 * render's own `url`, so it runs against that same value when the effect is
 * torn down (base64 changed, or unmount) — it never touches the URL a later
 * render is using.
 */
function useDocumentUrl(base64: string | undefined): string | undefined {
  const url = useMemo(() => (base64 ? toBlobUrl(base64) : undefined), [base64]);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return url;
}

export function DetailPanel({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: (id: string, patch: Partial<EditableProperties>) => void;
}) {
  const [record, setRecord] = useState<DetailedRecord | null>(null);
  const [failed, setFailed] = useState(false);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    setRecord(null);
    setFailed(false);
    askExtension({ type: 'get', id })
      .then((r) => {
        if (!live) return;
        if (r.ok && r.record) setRecord(r.record);
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id]);

  // Escape closes, and focus moves into the panel when it opens — a dialog
  // that leaves focus behind on the row underneath is one a keyboard cannot
  // reach without tabbing through the whole list again.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resumeUrl = useDocumentUrl(record?.resume?.base64);
  const coverLetterUrl = useDocumentUrl(record?.coverLetter?.base64);

  const save = (patch: Partial<EditableProperties>) => {
    if (!record) return;
    // Shown immediately and written behind it. A property that waited for the
    // round trip would feel like a form, and the write is local either way.
    setRecord({ ...record, ...patch });
    onChanged(record.id, patch);
  };

  return (
    <>
      <div className="detail-backdrop" onClick={onClose} aria-hidden="true" />
      <article
        className="detail"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={record ? `${record.company} — ${record.title}` : 'Application'}
      >
        <header className="detail-head">
          <div className="detail-title">
            {record ? (
              <>
                <h2>{record.company || record.hostname}</h2>
                <p className="hint" style={{ marginTop: 4 }}>
                  {record.title || record.hostname} · applied <RelativeDate at={record.appliedAt} />
                </p>
              </>
            ) : (
              <h2>{failed ? 'Could not read this one' : 'Loading…'}</h2>
            )}
          </div>
          {record?.url && (
            <a
              className="icon-button"
              href={record.url}
              target="_blank"
              rel="noreferrer"
              aria-label="Open the posting"
              title="Open the posting"
            >
              <ArrowSquareOut size={14} />
            </a>
          )}
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={14} weight="bold" />
          </button>
        </header>

        {record && (
          <div className="detail-body">
            <section className="detail-section">
              <h3>Properties</h3>
              <Properties value={record} onChange={save} />
            </section>

            <section className="detail-section">
              <h3>What was sent</h3>
              <ul className="doc-list">
                {/* Downloaded from bytes held on this machine. Nothing was
                    uploaded to produce this link. */}
                {record.resume && resumeUrl && (
                  <li>
                    <a className="doc-link" href={resumeUrl} download={record.resume.filename}>
                      <FileArrowDown size={15} aria-hidden="true" />
                      <span className="doc-link-name">{record.resume.filename}</span>
                      <span className="cell-num cell-muted">résumé</span>
                    </a>
                  </li>
                )}
                {record.coverLetter && coverLetterUrl && (
                  <li>
                    <a className="doc-link" href={coverLetterUrl} download={record.coverLetter.filename}>
                      <FileArrowDown size={15} aria-hidden="true" />
                      <span className="doc-link-name">{record.coverLetter.filename}</span>
                      <span className="cell-num cell-muted">letter</span>
                    </a>
                  </li>
                )}
                {!record.resume && !record.coverLetter && (
                  <li className="hint">No documents recorded for this one.</li>
                )}
              </ul>
              <p className="hint" style={{ marginTop: 'var(--space-3)' }}>
                {record.filledCount} fields filled
                {record.invalidCount > 0 && `, ${record.invalidCount} rejected by the form`} ·{' '}
                {record.questionsDrafted} questions drafted · {record.requestsSpent} model{' '}
                {record.requestsSpent === 1 ? 'request' : 'requests'}
              </p>
            </section>

            <section className="detail-section">
              <h3>Match</h3>
              {record.matchScore === null ? (
                <p className="hint">This one was not scored.</p>
              ) : (
                <p style={{ margin: '0 0 var(--space-3)' }}>
                  <strong style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.03em' }}>
                    {record.matchScore}
                  </strong>
                  <span className="hint"> / 100</span>
                </p>
              )}
              <div className="chips">
                {record.gapCovered.map((term) => (
                  <span key={term} className="chip">
                    {term}
                  </span>
                ))}
                {record.gapMissing.map((term) => (
                  <span key={term} className="chip chip-missing">
                    {term}
                  </span>
                ))}
                {record.gapCovered.length === 0 && record.gapMissing.length === 0 && (
                  <span className="hint">No keyword gap recorded.</span>
                )}
              </div>
              {record.estimatedFigures.length > 0 && (
                <p className="hint" style={{ marginTop: 'var(--space-3)' }}>
                  Figures the model estimated rather than read:{' '}
                  {record.estimatedFigures.join(', ')}
                </p>
              )}
              {record.variantIds.length > 0 && (
                <p className="hint" style={{ marginTop: 'var(--space-2)' }}>
                  Bullet variants sent: <span className="mono">{record.variantIds.join(' ')}</span>
                </p>
              )}
            </section>

            <section className="detail-section">
              <h3>The posting</h3>
              <pre className="jd">{record.jobDescription || 'Not captured.'}</pre>
            </section>
          </div>
        )}

        {failed && (
          <div className="detail-body">
            <p className="hint">
              The extension did not return this application. It may have been deleted since the list
              was read.
            </p>
          </div>
        )}
      </article>
    </>
  );
}
