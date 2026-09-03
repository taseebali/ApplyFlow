import type { BulletVariant } from './bullet-bank';
import type { Profile } from './schema';

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
}

export interface ResumeDocument {
  name: string;
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
 */
export function assembleResume(profile: Profile, selected: BulletVariant[]): ResumeDocument {
  const bySource = new Map<string, BulletVariant[]>();
  for (const variant of selected) {
    const list = bySource.get(variant.sourceId) ?? [];
    list.push(variant);
    bySource.set(variant.sourceId, list);
  }

  const experience = profile.workHistory
    .filter((role) => bySource.has(role.id))
    .map((role) => ({
      heading: [role.title, role.company].filter(Boolean).join(' — '),
      meta: [role.startDate, role.current ? 'present' : role.endDate].filter(Boolean).join(' – '),
      bullets: bySource.get(role.id)!.map((v) => v.text),
    }));

  const projects = profile.projects
    .filter((project) => bySource.has(project.id))
    .map((project) => ({
      heading: project.name,
      meta: project.techStack,
      bullets: bySource.get(project.id)!.map((v) => v.text),
    }));

  const education = profile.education.map((e) =>
    [
      [e.degree, e.fieldOfStudy].filter(Boolean).join(' in '),
      e.school,
      [e.startDate, e.current ? `${e.endDate} expected` : e.endDate].filter(Boolean).join(' – '),
    ]
      .filter(Boolean)
      .join(', ')
  );

  const c = profile.contact;

  return {
    name: [c.firstName, c.lastName].filter(Boolean).join(' '),
    contactLine: [c.email, c.phone, [c.city, c.country].filter(Boolean).join(', ')].filter(Boolean).join('  ·  '),
    linksLine: [profile.links.linkedin, profile.links.github, profile.links.portfolio || profile.links.website]
      .filter(Boolean)
      .join('  ·  '),
    experience,
    projects,
    education,
    // Every technology named across the projects, in the user's own words.
    skills: [...new Set(profile.projects.flatMap((p) => p.techStack.split(/[,;]/).map((t) => t.trim())))]
      .filter(Boolean)
      .join(', '),
  };
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
 * Renders a cover letter to .docx — same reasoning as the resume: Word parses
 * reliably, and the user can edit what comes out.
 */
export async function coverLetterToDocxBlob(input: {
  name: string;
  contactLine: string;
  body: string;
}): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, AlignmentType } = await import('docx');

  const paragraphs = input.body
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => new Paragraph({ text, spacing: { after: 160 } }));

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: input.name, bold: true, size: 28 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [new TextRun({ text: input.contactLine, size: 20 })],
          }),
          ...paragraphs,
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
