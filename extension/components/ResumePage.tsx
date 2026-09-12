import { useEffect, useRef } from 'react';
import { headingText, type CoverLetterDocument, type HeadingKey, type ResumeDocument } from '@/lib/resume-document';

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
  placeholder,
  inline,
}: {
  value: string;
  onChange: (text: string) => void;
  className?: string;
  label: string;
  /** Shown when empty, so a blank line is still somewhere to click. */
  placeholder?: string;
  /**
   * Rendered as a span rather than a div, for text that shares a line.
   *
   * Not only a styling choice: an entry's title and its dates sit inside one
   * paragraph, and a `<div>` inside a `<p>` is invalid HTML that the browser
   * repairs by ending the paragraph early — which put the dates on their own
   * line, under the title, on every role and project on the page.
   */
  inline?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const Tag = (inline ? 'span' : 'div') as 'div';

  useEffect(() => {
    const element = ref.current;
    if (element && element.textContent !== value) element.textContent = value;
  }, [value]);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={['editable', inline && 'editable-inline', className].filter(Boolean).join(' ')}
      // Plain text only: a resume line pasted from a browser would otherwise
      // arrive carrying markup that the .docx export cannot represent.
      contentEditable="plaintext-only"
      role="textbox"
      aria-label={label}
      data-placeholder={placeholder ?? ''}
      suppressContentEditableWarning
      onInput={(event) => onChange(event.currentTarget.textContent ?? '')}
    />
  );
}

const EditableInline = (props: Parameters<typeof Editable>[0]) => <Editable {...props} inline />;

export interface ResumePageProps {
  document: ResumeDocument;
  /** Called with the new text of one bullet, addressed by section and index. */
  onEditBullet: (kind: 'experience' | 'projects', section: number, bullet: number, text: string) => void;
  /**
   * The heading, dates line and link of one role or project.
   *
   * These were the last read-only text on the page. A job title typed wrong,
   * or dates the profile has as "2023-2024" that this employer writes as
   * "Jan 2023 – Dec 2024", meant saving the file and fixing it in Word — which
   * is exactly the round trip this screen exists to remove.
   */
  onEditSection: (
    kind: 'experience' | 'projects',
    section: number,
    field: 'heading' | 'meta' | 'link',
    text: string
  ) => void;
  /** A section's title, so "Projects" can become "Selected Work" or "Projekte". */
  onEditHeading: (key: HeadingKey, text: string) => void;
  /**
   * Any other line, by the field it belongs to. Everything on the page is
   * editable: the first version made only bullets and the summary editable, so
   * a wrong heading, a stale contact line or a mistyped skill meant leaving the
   * page to fix it.
   */
  onEdit: (field: EditableField, text: string, index?: number) => void;
}

export type EditableField =
  | 'name'
  | 'headline'
  | 'contactLine'
  | 'linksLine'
  | 'summary'
  | 'languages'
  | 'education'
  | 'certifications'
  | 'skills'
  | 'skillLabel';

export function ResumePage({ document, onEditBullet, onEditSection, onEditHeading, onEdit }: ResumePageProps) {
  /** A section title on the page, which is itself a line the user can retype. */
  const Heading = ({ which }: { which: HeadingKey }) => (
    <h3 className="doc-heading">
      <EditableInline
        value={headingText(document, which)}
        label={`${headingText(document, which)} section title`}
        onChange={(t) => onEditHeading(which, t)}
      />
    </h3>
  );

  const sections = (kind: 'experience' | 'projects') =>
    document[kind].map((section, sectionIndex) => (
      <div className="doc-entry" key={`${kind}-${sectionIndex}`}>
        <div className="doc-entry-head">
          <EditableInline
            className="doc-entry-title"
            value={section.heading}
            label={`Title of entry ${sectionIndex + 1}`}
            onChange={(t) => onEditSection(kind, sectionIndex, 'heading', t)}
          />
          <EditableInline
            className="doc-meta"
            value={section.meta}
            placeholder="dates or tech"
            label={`Dates or technologies for ${section.heading}`}
            onChange={(t) => onEditSection(kind, sectionIndex, 'meta', t)}
          />
        </div>
        {section.link !== undefined && (
          <div className="doc-link">
            <Editable
              value={section.link}
              label={`Link for ${section.heading}`}
              onChange={(t) => onEditSection(kind, sectionIndex, 'link', t)}
            />
          </div>
        )}
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
      <Editable className="doc-name" value={document.name} label="Your name" onChange={(t) => onEdit('name', t)} />
      <Editable
        className="doc-headline"
        value={document.headline}
        label="Headline"
        placeholder="What you do, in a few words"
        onChange={(t) => onEdit('headline', t)}
      />
      <Editable
        className="doc-contact"
        value={document.contactLine}
        label="Contact line"
        placeholder="Email · phone · city"
        onChange={(t) => onEdit('contactLine', t)}
      />
      <Editable
        className="doc-contact"
        value={document.linksLine}
        label="Links line"
        placeholder="GitHub · LinkedIn · site"
        onChange={(t) => onEdit('linksLine', t)}
      />

      <Heading which="summary" />
      <Editable
        value={document.summary}
        label="Summary"
        placeholder="What you build, in two or three lines."
        onChange={(t) => onEdit('summary', t)}
      />

      {document.experience.length > 0 && <Heading which="experience" />}
      {sections('experience')}

      {document.projects.length > 0 && <Heading which="projects" />}
      {sections('projects')}

      {document.education.length > 0 && (
        <>
          <Heading which="education" />
          {document.education.map((line, index) => (
            <Editable
              key={index}
              value={line}
              label={`Education line ${index + 1}`}
              onChange={(t) => onEdit('education', t, index)}
            />
          ))}
        </>
      )}

      {document.certifications.length > 0 && (
        <>
          <Heading which="certifications" />
          <ul className="doc-bullets">
            {document.certifications.map((line, index) => (
              <li key={index}>
                <Editable
                  value={line}
                  label={`Certification ${index + 1}`}
                  onChange={(t) => onEdit('certifications', t, index)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {document.languages && (
        <>
          <Heading which="languages" />
          <Editable value={document.languages} label="Languages" onChange={(t) => onEdit('languages', t)} />
        </>
      )}

      {document.skills.length > 0 && (
        <>
          <Heading which="skills" />
          {document.skills.map((group, index) => (
            <div key={index} className="doc-skill-row">
              {group.label !== undefined && (
                <EditableInline
                  className="doc-skill-label"
                  value={group.label}
                  label={`Skill group ${index + 1} name`}
                  onChange={(t) => onEdit('skillLabel', t, index)}
                />
              )}
              <Editable
                className="doc-skill-items"
                value={group.items.join(', ')}
                label={group.label ? `${group.label} skills` : 'Skills'}
                onChange={(t) => onEdit('skills', t, index)}
              />
            </div>
          ))}
        </>
      )}
    </article>
  );
}

/**
 * The letter, in the same frame, with its furniture where the export puts it.
 *
 * Editable throughout for the same reason the resume is. The recipient block
 * in particular is assembled from what we know — the company and "Hiring
 * Team" — and a posting that names the hiring manager is a letter that should
 * say their name.
 */
export function LetterPage({
  letter,
  body,
  onEditBody,
  onEditLetter,
}: {
  letter: CoverLetterDocument;
  body: string;
  onEditBody: (text: string) => void;
  onEditLetter: (patch: Partial<CoverLetterDocument>) => void;
}) {
  const replaceLine = (lines: string[], index: number, text: string) =>
    lines.map((line, i) => (i === index ? text : line));

  return (
    <article className="doc">
      {letter.senderLines.map((line, index) => (
        <Editable
          key={`sender-${index}`}
          className={index === 0 ? 'doc-name doc-name-small' : 'doc-contact'}
          value={line}
          label={`Your address line ${index + 1}`}
          onChange={(t) => onEditLetter({ senderLines: replaceLine(letter.senderLines, index, t) })}
        />
      ))}

      <div className="doc-letter-block">
        {letter.recipientLines.map((line, index) => (
          <Editable
            key={`recipient-${index}`}
            value={line}
            label={`Recipient line ${index + 1}`}
            onChange={(t) => onEditLetter({ recipientLines: replaceLine(letter.recipientLines, index, t) })}
          />
        ))}
      </div>

      <Editable
        className="doc-letter-date"
        value={letter.date}
        label="Date"
        onChange={(t) => onEditLetter({ date: t })}
      />
      <Editable
        className="doc-letter-subject"
        value={letter.subject}
        label="Subject line"
        onChange={(t) => onEditLetter({ subject: t })}
      />
      <Editable
        value={letter.salutation}
        label="Salutation"
        onChange={(t) => onEditLetter({ salutation: t })}
      />

      <Editable className="doc-letter-body" value={body} label="Cover letter body" onChange={onEditBody} />

      <Editable value={letter.closing} label="Sign-off" onChange={(t) => onEditLetter({ closing: t })} />
      <Editable value={letter.signature} label="Signature" onChange={(t) => onEditLetter({ signature: t })} />
    </article>
  );
}
