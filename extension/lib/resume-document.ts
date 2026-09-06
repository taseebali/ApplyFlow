import { contentTerms, type BulletVariant } from './bullet-bank';
import { CONVENTIONS, type LetterLanguage } from './letter-language';
import type { BulletEntry, Profile } from './schema';

/**
 * Assembling and exporting the tailored resume.
 *
 * `.docx` rather than PDF for one reason that outweighs how it looks: applicant
 * tracking systems parse Word reliably and mangle typeset PDFs. Single column,
 * real headings, no tables and no text boxes — the layout tricks that make a
 * resume pretty are the ones that make it unreadable to a parser. The user can
 * also open and edit the result, which a generated PDF does not allow.
 *
 * The `docx` library is several megabytes, so it is imported only when an
 * export actually happens — the same treatment `pdfjs` gets in resume-text.ts.
 */

export interface ResumeSection {
  /** "Engineer at Revel8" or a project name. */
  heading: string;
  /** The right-hand line: dates, or a technology list. */
  meta: string;
  bullets: string[];
  /**
   * False when this section fell back to the user's own wording because the
   * bank had nothing for it. The document is still complete; it just was not
   * tailored here, and the review screen says so rather than hiding it.
   */
  tailored: boolean;
}

export interface ResumeDocument {
  name: string;
  /** "AI Engineer · Berlin", when the profile has one. */
  headline: string;
  contactLine: string;
  linksLine: string;
  experience: ResumeSection[];
  projects: ResumeSection[];
  education: string[];
  skills: string;
}

/**
 * Turns the selected variants into the document's shape.
 *
 * Sections keep the profile's own order — chronology is the user's, not
 * something relevance ranking should rearrange. Only *which* bullets appear,
 * and their order within a section, comes from selection.
 *
 * A source with no selected variant falls back to the bullets the user wrote
 * themselves. This matters more than anything else here: generation can fail
 * for one item — a rate-limited model, a parse failure — and when it did, the
 * old behaviour dropped that whole job off the resume without saying so. The
 * bank is an optimisation; the profile is the truth. Untailored wording is a
 * small problem, a missing job is a serious one.
 */
export function assembleResume(
  profile: Profile,
  selected: BulletVariant[],
  jobDescription = ''
): ResumeDocument {
  const bySource = new Map<string, BulletVariant[]>();
  for (const variant of selected) {
    const list = bySource.get(variant.sourceId) ?? [];
    list.push(variant);
    bySource.set(variant.sourceId, list);
  }

  const linesFor = (id: string, own: BulletEntry[]) => {
    const chosen = bySource.get(id);
    if (chosen && chosen.length > 0) return { bullets: chosen.map((v) => v.text), tailored: true };
    return { bullets: own.map((b) => b.text).filter(Boolean), tailored: false };
  };

  const experience = profile.workHistory
    .map((role) => ({
      heading: [role.title, role.company].filter(Boolean).join(' — '),
      meta: [role.startDate, role.current ? 'present' : role.endDate].filter(Boolean).join(' – '),
      ...linesFor(role.id, role.bullets),
    }))
    // Nothing written and nothing generated means there is nothing to say.
    .filter((section) => section.bullets.length > 0);

  const projects = profile.projects
    .map((project) => ({
      heading: project.name,
      meta: project.techStack,
      ...linesFor(project.id, project.bullets),
    }))
    .filter((section) => section.bullets.length > 0);

  const education = profile.education.map((e) =>
    [
      degreeLine(e.degree, e.fieldOfStudy),
      e.school,
      [e.startDate, e.current ? `${e.endDate} expected` : e.endDate].filter(Boolean).join(' – '),
    ]
      .filter(Boolean)
      .join(', ')
  );

  const c = profile.contact;

  return {
    name: [c.firstName, c.lastName].filter(Boolean).join(' '),
    headline: profile.headline.trim(),
    contactLine: [c.email, c.phone, [c.city, c.country].filter(Boolean).join(', ')].filter(Boolean).join('  ·  '),
    linksLine: [profile.links.linkedin, profile.links.github, profile.links.portfolio || profile.links.website]
      .filter(Boolean)
      .join('  ·  '),
    experience,
    projects,
    education,
    skills: orderSkills(profile.skills, jobDescription).join(', '),
  };
}

/**
 * The skills the posting actually asks for, first.
 *
 * A skills line is read left to right and often truncated, so the order is the
 * only lever available. The user's own order is preserved within each group,
 * because they know which of their skills they would rather lead with.
 */
function orderSkills(skills: string[], jobDescription: string): string[] {
  const clean = skills.map((skill) => skill.trim()).filter(Boolean);
  if (!jobDescription.trim()) return clean;

  const asked = new Set(contentTerms(jobDescription));
  const mentioned = (skill: string) =>
    contentTerms(skill).some((term) => asked.has(term));

  return [...clean.filter(mentioned), ...clean.filter((skill) => !mentioned(skill))];
}

/**
 * "B.Sc." + "Computer Science" reads well; "B.Sc. Computer Science" +
 * "Computer Science" produced "B.Sc. Computer Science in Computer Science" on
 * a real resume, because people put the subject in the degree field too.
 */
function degreeLine(degree: string, fieldOfStudy: string): string {
  const trimmedDegree = degree.trim();
  const field = fieldOfStudy.trim();
  if (!field) return trimmedDegree;
  if (!trimmedDegree) return field;
  return trimmedDegree.toLowerCase().includes(field.toLowerCase())
    ? trimmedDegree
    : `${trimmedDegree} in ${field}`;
}

/** A filename that sorts sensibly in a folder and says what it is. */
export function resumeFilename(document: ResumeDocument, company: string): string {
  const safe = (text: string) => text.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
  const owner = safe(document.name);
  // Without a name on the profile, "Resume_Resume_Acme" is what the obvious
  // version produces.
  return [owner, 'Resume', safe(company)].filter(Boolean).join('_') + '.docx';
}

/**
 * Renders the document to a .docx blob.
 *
 * Lazy-imported: `docx` is megabytes, and most sessions never export anything.
 */
export async function toDocxBlob(resume: ResumeDocument): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import('docx');

  const heading = (text: string) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 80 },
      children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22 })],
    });

  const sectionParagraphs = (section: ResumeSection) => [
    new Paragraph({
      spacing: { before: 120, after: 40 },
      children: [
        new TextRun({ text: section.heading, bold: true, size: 22 }),
        ...(section.meta ? [new TextRun({ text: `   ${section.meta}`, italics: true, size: 20 })] : []),
      ],
    }),
    // A real list, not a hyphen typed at the start of a line: parsers read the
    // structure, and a reader gets proper indentation.
    ...section.bullets.map(
      (text) => new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 40 } })
    ),
  ];

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: resume.name, bold: true, size: 32 })],
    }),
    ...(resume.headline
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: resume.headline, size: 22 })],
          }),
        ]
      : []),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: resume.contactLine, size: 20 })],
    }),
    ...(resume.linksLine
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: resume.linksLine, size: 20 })],
          }),
        ]
      : []),

    ...(resume.experience.length > 0
      ? [heading('Experience'), ...resume.experience.flatMap(sectionParagraphs)]
      : []),
    ...(resume.projects.length > 0 ? [heading('Projects'), ...resume.projects.flatMap(sectionParagraphs)] : []),
    ...(resume.education.length > 0
      ? [heading('Education'), ...resume.education.map((line) => new Paragraph({ text: line, spacing: { after: 40 } }))]
      : []),
    ...(resume.skills ? [heading('Skills'), new Paragraph({ text: resume.skills })] : []),
  ];

  const doc = new Document({
    sections: [{ properties: {}, children }],
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 21 } },
      },
    },
  });

  return Packer.toBlob(doc);
}
/**
 * A cover letter with everything a letter has, not just its argument.
 *
 * The structure is assembled here rather than requested in the prompt. A model
 * asked for a salutation sometimes writes one and sometimes does not, and asked
 * *not* to — which is what the prompt used to say — reliably produces three
 * paragraphs of prose with a name on top. That is not a letter, and it is what
 * shipped. Date, recipient, subject, salutation and sign-off are facts about
 * the application, so they are built from the application rather than hoped for.
 */
export interface CoverLetterDocument {
  language: LetterLanguage;
  senderLines: string[];
  recipientLines: string[];
  date: string;
  dateOnRight: boolean;
  subject: string;
  salutation: string;
  paragraphs: string[];
  closing: string;
  signature: string;
}

export function assembleCoverLetter(input: {
  profile: Profile;
  company: string;
  role: string;
  body: string;
  language: LetterLanguage;
  /** Injectable so the rendered date is testable. */
  today?: Date;
}): CoverLetterDocument {
  const { profile, company, role, body, language, today = new Date() } = input;
  const convention = CONVENTIONS[language];
  const c = profile.contact;
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ');

  return {
    language,
    senderLines: [
      name,
      c.addressLine1,
      c.addressLine2,
      [c.postalCode, c.city].filter(Boolean).join(' '),
      c.country,
      c.email,
      c.phone,
    ].filter(Boolean),
    // Only what we actually know. An invented street address on a cover letter
    // is worse than no address block at all.
    recipientLines: [company.trim(), 'Hiring Team'].filter(Boolean),
    date: convention.formatDate(today),
    dateOnRight: convention.dateOnRight,
    subject: convention.subject(role.trim()),
    salutation: convention.salutation(company.trim()),
    paragraphs: splitParagraphs(body),
    closing: convention.closing,
    signature: name,
  };
}

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean);
}

/**
 * Renders a cover letter to .docx — same reasoning as the resume: Word parses
 * reliably, and the user can edit what comes out.
 */
export async function coverLetterToDocxBlob(letter: CoverLetterDocument): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, AlignmentType } = await import('docx');

  const line = (text: string, options: { bold?: boolean; after?: number; right?: boolean } = {}) =>
    new Paragraph({
      alignment: options.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { after: options.after ?? 0 },
      children: [new TextRun({ text, bold: options.bold, size: 21 })],
    });

  const last = (index: number, list: unknown[], gap: number) => (index === list.length - 1 ? gap : 0);

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          ...letter.senderLines.map((text, index) =>
            line(text, { bold: index === 0, after: last(index, letter.senderLines, 360) })
          ),
          ...letter.recipientLines.map((text, index) =>
            line(text, { after: last(index, letter.recipientLines, 240) })
          ),
          line(letter.date, { right: letter.dateOnRight, after: 360 }),
          line(letter.subject, { bold: true, after: 240 }),
          line(letter.salutation, { after: 240 }),
          ...letter.paragraphs.map((text) => new Paragraph({ text, spacing: { after: 200 } })),
          line(letter.closing, { after: 360 }),
          line(letter.signature),
        ],
      },
    ],
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
  });

  return Packer.toBlob(doc);
}


/** Companion to `resumeFilename`, so the pair sit together in the folder. */
export function coverLetterFilename(document: ResumeDocument, company: string): string {
  const safe = (text: string) => text.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
  return [safe(document.name), 'CoverLetter', safe(company)].filter(Boolean).join('_') + '.docx';
}
