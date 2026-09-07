import { useEffect, useRef } from 'react';
import type { CoverLetterDocument, ResumeDocument } from '@/lib/resume-document';

/**
 * The resume as a page, at the size it prints.
 *
 * The review screen used to be a form that described the document: a column of
 * textareas, a "your wording" pill, a fault pill. You never saw the resume.
 * The thing you were about to send was only visible after saving it and
 * opening it in Word, which is where every fault in it was found.
 *
 * Rendered from the same `ResumeDocument` that `toDocxBlob` consumes, so the
 * preview and the file cannot drift — and in the same section order, so what
 * fits here is what fits there.
 */

/**
 * One line of the document, edited in place.
 *
 * Uncontrolled on purpose. Re-rendering a contenteditable from state on every
 * keystroke moves the caret to the start, so the DOM is only written when the
 * incoming value actually differs from what is on screen — which, right after
 * typing, it does not.
 */
function Editable({
  value,
  onChange,
  className,
  label,
}: {
  value: string;
  onChange: (text: string) => void;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (element && element.textContent !== value) element.textContent = value;
  }, [value]);

  return (
    <div
      ref={ref}
      className={`editable ${className ?? ''}`}
      // Plain text only: a resume line pasted from a browser would otherwise
      // arrive carrying markup that the .docx export cannot represent.
      contentEditable="plaintext-only"
      role="textbox"
      aria-label={label}
      suppressContentEditableWarning
      onInput={(event) => onChange(event.currentTarget.textContent ?? '')}
    />
  );
}

export interface ResumePageProps {
  document: ResumeDocument;
  /** Called with the new text of one bullet, addressed by section and index. */
  onEditBullet: (kind: 'experience' | 'projects', section: number, bullet: number, text: string) => void;
  onEditSummary: (text: string) => void;
}

export function ResumePage({ document, onEditBullet, onEditSummary }: ResumePageProps) {
  const sections = (kind: 'experience' | 'projects') =>
    document[kind].map((section, sectionIndex) => (
      <div className="doc-entry" key={`${section.heading}-${sectionIndex}`}>
        <p className="doc-entry-head">
          <strong>{section.heading}</strong>
          {section.meta && <span className="doc-meta">   {section.meta}</span>}
        </p>
        {section.link && <p className="doc-link">{section.link}</p>}
        <ul className="doc-bullets">
          {section.bullets.map((text, bulletIndex) => {
            // Figures the model worked out rather than read. Marked on the page
            // rather than only counted in the rail, because the point is to
            // look at the sentence before deciding to stand behind it.
            const estimated = section.estimated?.[bulletIndex] ?? [];
            return (
              <li key={bulletIndex} className={estimated.length > 0 ? 'doc-estimated' : undefined}>
                <Editable
                  value={text}
                  label={`Bullet ${bulletIndex + 1} under ${section.heading}`}
                  onChange={(next) => onEditBullet(kind, sectionIndex, bulletIndex, next)}
                />
                {estimated.length > 0 && (
                  <span className="doc-estimate-tag" title={`Estimated: ${estimated.join(', ')}`}>
                    estimated {estimated.join(', ')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    ));

  return (
    <article className="doc">
      <h2 className="doc-name">{document.name}</h2>
      {document.headline && <p className="doc-headline">{document.headline}</p>}
      <p className="doc-contact">{document.contactLine}</p>
      {document.linksLine && <p className="doc-contact">{document.linksLine}</p>}

      {document.summary && (
        <>
          <h3 className="doc-heading">Summary</h3>
          <Editable value={document.summary} label="Summary" onChange={onEditSummary} />
        </>
      )}

      {document.experience.length > 0 && <h3 className="doc-heading">Experience</h3>}
      {sections('experience')}

      {document.projects.length > 0 && <h3 className="doc-heading">Projects</h3>}
      {sections('projects')}

      {document.education.length > 0 && (
        <>
          <h3 className="doc-heading">Education</h3>
          {document.education.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </>
      )}

      {document.certifications.length > 0 && (
        <>
          <h3 className="doc-heading">Certifications</h3>
          <ul className="doc-bullets">
            {document.certifications.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}

      {document.languages && (
        <>
          <h3 className="doc-heading">Languages</h3>
          <p>{document.languages}</p>
        </>
      )}

      {document.skills.length > 0 && (
        <>
          <h3 className="doc-heading">Skills</h3>
          {document.skills.map((group, index) => (
            <p key={group.label ?? index}>
              {group.label && <strong>{group.label}: </strong>}
              {group.items.join(', ')}
            </p>
          ))}
        </>
      )}
    </article>
  );
}

/** The letter, in the same frame, with its furniture where the export puts it. */
export function LetterPage({
  letter,
  body,
  onEditBody,
}: {
  letter: CoverLetterDocument;
  body: string;
  onEditBody: (text: string) => void;
}) {
  return (
    <article className="doc">
      <p className="doc-name doc-name-small">{letter.senderLines[0]}</p>
      {letter.senderLines.slice(1).map((line) => (
        <p className="doc-contact" key={line}>
          {line}
        </p>
      ))}

      <p className="doc-letter-block">{letter.recipientLines.join('\n')}</p>
      <p className="doc-letter-date">{letter.date}</p>
      <p>
        <strong>{letter.subject}</strong>
      </p>
      <p>{letter.salutation}</p>

      <Editable className="doc-letter-body" value={body} label="Cover letter body" onChange={onEditBody} />

      <p>{letter.closing}</p>
      <p>{letter.signature}</p>
    </article>
  );
}
