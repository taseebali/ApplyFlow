import { contentTerms, type BulletVariant } from './bullet-bank';
import {
  DEFAULT_STYLE,
  halfPoints,
  lineTwips,
  twips,
  type DocumentStyle,
  A4_HEIGHT_TWIPS,
  A4_WIDTH_TWIPS,
} from './document-style';
import { postingTerms } from './keyword-gap';
import { CONVENTIONS, type LetterLanguage } from './letter-language';
import { parseSkillRows } from './skill-groups';
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
   * Per bullet, the figures the model estimated rather than read. Parallel to
   * `bullets`, empty for everything the user wrote. An estimate is a number you
   * have to defend in an interview, so the review page marks them.
   */
  estimated?: string[][];
  /** Where the work can be seen. The first thing a technical reader clicks. */
  link?: string;
  /**
   * False when this section fell back to the user's own wording because the
   * bank had nothing for it. The document is still complete; it just was not
   * tailored here, and the review screen says so rather than hiding it.
   */
  tailored: boolean;
}

export interface SkillGroup {
  /** "Languages", "AI and automation". Absent for an ungrouped list. */
  label?: string;
  items: string[];
}

export interface ResumeDocument {
  name: string;
  /** "AI Engineer · Berlin", when the profile has one. */
  headline: string;
  /** Two or three lines under the name saying what this person builds. */
  summary: string;
  contactLine: string;
  linksLine: string;
  experience: ResumeSection[];
  projects: ResumeSection[];
  education: string[];
  skills: SkillGroup[];
  /** "German (fluent) · English (native)". A page with none simply omits it. */
  languages: string;
  certifications: string[];
  /** Sections left off because the page only has room for so many. */
  omitted: string[];
  /**
   * Renamed section headings, when the user has renamed any.
   *
   * Optional and sparse: a document that has never been retitled carries
   * nothing, and `headingText` falls back. People do rename these — "Selected
   * Projects", or the German set for a German application — and before this
   * the only way was to save the file and retype them in Word.
   */
  headings?: Partial<Record<HeadingKey, string>>;
}

export type HeadingKey =
  | 'summary'
  | 'experience'
  | 'projects'
  | 'education'
  | 'certifications'
  | 'languages'
  | 'skills';

export const DEFAULT_HEADINGS: Record<HeadingKey, string> = {
  summary: 'Summary',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  languages: 'Languages',
  skills: 'Skills',
};

/** What a section is called on this document, renamed or not. */
export function headingText(document: ResumeDocument, key: HeadingKey): string {
  return document.headings?.[key] ?? DEFAULT_HEADINGS[key];
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
/**
 * How many project sections a resume shows.
 *
 * A resume is a page, not an archive. Eleven projects rendered as eleven
 * paragraphs is what came out when the bank was empty and every source fell
 * back to its own wording with nothing trimming the list.
 */
const MAX_PROJECTS = 4;

/** The most lines any one role or project gets, however much source it has. */
const MAX_BULLETS = 4;

export function assembleResume(
  profile: Profile,
  selected: BulletVariant[],
  jobDescription = '',
  maxProjects = MAX_PROJECTS
): ResumeDocument {
  const bySource = new Map<string, BulletVariant[]>();
  for (const variant of selected) {
    const list = bySource.get(variant.sourceId) ?? [];
    list.push(variant);
    bySource.set(variant.sourceId, list);
  }

  /*
   * How many lines one item earns.
   *
   * A flat cap gave three near-identical bullets to a project whose whole
   * source was one sentence — "Designed a backtracking algorithm", "Built a
   * backtracking implementation", "Solved the Knight's Tour end-to-end" are
   * three angles on the same thing, because generation writes six framings per
   * source however thin the source is. The source is the honest limit: an item
   * with one sentence behind it gets one line.
   */
  const bulletBudget = (own: BulletEntry[]) => {
    const sentences = own.flatMap((b) => asBullets(b.text)).length;
    // Nothing to measure against means no basis for a tighter cap, so the flat
    // maximum stands. Cutting to one line there would punish an item for
    // having no stored source rather than for having nothing to say.
    return sentences === 0 ? MAX_BULLETS : Math.min(sentences, MAX_BULLETS);
  };

  const linesFor = (id: string, own: BulletEntry[]) => {
    const budget = bulletBudget(own);
    const chosen = bySource.get(id);
    // Figures the model worked out rather than read, kept alongside the text so
    // the review page can mark them before anything is sent.
    // The same budget on both paths. They used to differ — four from the
    // fallback, three from the bank — so the count on the page depended on
    // which one had run.
    /*
     * Generated bullets go through the same filter the imported ones do.
     *
     * They did not, and a variant whose text was a bare "…" printed as a
     * bullet on the page — the punctuation-only check below was doing its job
     * on the fallback path and was simply not on this one. A source whose
     * generated bullets are all discarded then falls through to the person's
     * own wording rather than printing a project with nothing under it.
     */
    const printable = (chosen ?? []).filter((v) => asBullets(v.text).length > 0);
    if (printable.length > 0) {
      const picked = printable.slice(0, budget);
      return {
        bullets: picked.map((v) => v.text.trim()),
        tailored: true,
        estimated: picked.map((v) => v.estimated ?? []),
      };
    }
    // Imported descriptions arrive as one blob per project, and printing that
    // blob is how a resume becomes a wall of prose. Split it into sentences,
    // which is what a bullet list is.
    return { bullets: own.flatMap((b) => asBullets(b.text)).slice(0, budget), tailored: false, estimated: [] };
  };

  const experience = profile.workHistory
    .map((role) => ({
      heading: [role.title, role.company].filter(Boolean).join(' — '),
      meta: [role.startDate, role.current ? 'present' : role.endDate].filter(Boolean).join(' – '),
      ...linesFor(role.id, role.bullets),
    }))
    // Nothing written and nothing generated means there is nothing to say.
    .filter((section) => section.bullets.length > 0);

  const allProjects = profile.projects
    .map((project) => ({
      heading: project.name,
      meta: project.techStack,
      link: project.link.trim(),
      ...linesFor(project.id, project.bullets),
    }))
    .filter((section) => section.bullets.length > 0);

  /*
   * What goes on the page, and in what order.
   *
   * This used to be `(tailored ? 1000 : 0) + term overlap`, and the 1000 was
   * the whole ranking: any project the bank had succeeded for outranked any
   * project it had failed for, whatever either was worth. A weekend
   * backtracking exercise made an AI resume while a vision system with real
   * numbers was cut, purely because generation had happened to work for one
   * and not the other. Bank coverage is now a tie-break worth one point.
   *
   * Relevance is measured against what the posting asks for rather than every
   * word in it — the raw term list had "why", "days" and "built" in it, and
   * ranking against those is ranking against noise.
   *
   * Substance is the other half. Without it a one-line project that happens to
   * name a matching tool beats a substantial one that does not, which is the
   * same failure in a different coat.
   */
  const asks = postingTerms(jobDescription);

  const relevance = (section: ResumeSection) => {
    const terms = contentTerms(`${section.heading} ${section.meta} ${section.bullets.join(' ')}`);
    // A repeated ask counts for more: postings repeat what they care about.
    const match = terms.reduce((sum, term) => sum + Math.min(asks.get(term) ?? 0, 3), 0);
    const substance =
      // Something to say, said in more than one line.
      Math.min(section.bullets.length, 3) +
      // A number in a bullet is the difference between a claim and a result.
      (section.bullets.some((line) => /\d/.test(line)) ? 2 : 0);
    return match * 3 + substance + (section.tailored ? 1 : 0);
  };

  const ranked = [...allProjects].sort((a, b) => relevance(b) - relevance(a));
  const kept = new Set(ranked.slice(0, maxProjects));
  const projects = allProjects.filter((section) => kept.has(section));
  const omitted = allProjects.filter((section) => !kept.has(section)).map((section) => section.heading);

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
    /*
     * One paragraph, whatever the source did.
     *
     * A summary imported from a PDF carries that PDF's hard line wraps, and
     * `.trim()` only removed the ones at the ends — so the headline paragraph
     * of the resume printed as three ragged lines broken mid-sentence, at
     * whatever width the original document happened to be. Runs of whitespace
     * collapse to single spaces; a summary has no internal structure to lose.
     */
    summary: profile.summary.replace(/\s+/g, ' ').trim(),
    contactLine: [c.email, c.phone, [c.city, c.country].filter(Boolean).join(', ')].filter(Boolean).join('  ·  '),
    linksLine: [profile.links.linkedin, profile.links.github, profile.links.portfolio || profile.links.website]
      .filter(Boolean)
      .join('  ·  '),
    experience,
    projects,
    education,
    skills: groupSkills(orderSkills(profile.skills, jobDescription)),
    languages: profile.languages
      .map((entry) => (entry.level ? `${entry.language} (${entry.level})` : entry.language))
      .filter((line) => line.trim().length > 0)
      .join('  ·  '),
    certifications: profile.certifications
      .map((entry) => [entry.name, entry.issuer, entry.date].filter(Boolean).join(', '))
      .filter(Boolean),
    omitted,
  };
}

/**
 * Splits a paragraph into the bullets it should have been.
 *
 * Resume import stores one blob per project, and the fallback printed it
 * whole. Sentence boundaries are the only structure such a blob has, and they
 * are usually the right ones.
 */
function asBullets(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // An imported bullet that is only punctuation — a literal "..." came through
  // one resume — is not a line worth printing on a page.
  if (!/[a-z]/i.test(trimmed)) return [];
  if (trimmed.length <= 200) return [trimmed];
  return trimmed
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20);
}

/**
 * "Languages: Python, SQL" on its own line becomes a labelled group.
 *
 * A flat comma run of forty terms is unreadable, and grouping is what a real
 * resume does. The syntax is the one people already type, so it costs no
 * schema change and no new editor.
 */
function groupSkills(skills: string[]): SkillGroup[] {
  // The same parse the skills editor uses, so what is typed as a group prints
  // as one. Two copies of this regex is how the editor and the page drift.
  return parseSkillRows(skills).map((row) => (row.label ? row : { items: row.items }));
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

/** Filename-safe, and the same rule for every document so they sort together. */
const safe = (text: string) => text.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');

/** A filename that sorts sensibly in a folder and says what it is. */
export function resumeFilename(document: ResumeDocument, company: string): string {
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
export async function toDocxBlob(resume: ResumeDocument, style = DEFAULT_STYLE): Promise<Blob> {
  const { Document, Packer } = await import('docx');
  const doc = new Document({
    sections: [{ properties: pageProperties(style), children: await resumeParagraphs(resume, style) }],
    styles: documentDefaults(style),
  });
  return Packer.toBlob(doc);
}

/**
 * Typeface, size and leading, in one place for all three exports.
 *
 * Set as the document default rather than on every run, so a paragraph that
 * does not say otherwise inherits it — which is also how Word itself behaves
 * when someone opens the file and changes the body style.
 */
function documentDefaults(style: DocumentStyle) {
  return {
    default: {
      document: {
        run: { font: style.font, size: halfPoints(style.size) },
        paragraph: { spacing: { line: lineTwips(style.line), lineRule: 'auto' as const } },
      },
    },
  };
}

function pageProperties(style: DocumentStyle) {
  const margin = twips(style.margin);
  /*
   * A4, stated rather than defaulted.
   *
   * The `docx` library defaults to US Letter, which is 11" tall; the preview
   * and the PDF are measured against A4 at 11.69". So a resume trimmed to fit
   * exactly one page on screen printed as one page and saved as *two* in Word
   * — three quarters of an inch of content with nowhere to go. The page rule
   * in the review tab and the page in the file are now the same sheet.
   */
  return {
    page: {
      size: { width: A4_WIDTH_TWIPS, height: A4_HEIGHT_TWIPS },
      margin: { top: margin, right: margin, bottom: margin, left: margin },
    },
  };
}

/**
 * The resume's paragraphs, separately from the document that wraps them, so
 * the combined export can place them after the letter rather than rebuilding
 * the layout a second time and drifting from it.
 */
async function resumeParagraphs(resume: ResumeDocument, style: DocumentStyle = DEFAULT_STYLE) {
  const { Paragraph, TextRun, HeadingLevel, AlignmentType } = await import('docx');

  /*
   * Every size on the page as a ratio of the body size, so choosing 12pt
   * scales the name and the section rules with it. They used to be absolute
   * half-points — 32 for the name, 22 for a heading — which meant a larger
   * body size made the document look wrong rather than larger.
   */
  const scaled = (ratio: number) => Math.round(halfPoints(style.size) * ratio);

  const heading = (text: string) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 80 },
      children: [new TextRun({ text: text.toUpperCase(), bold: true, size: scaled(1.05) })],
    });

  const sectionParagraphs = (section: ResumeSection) => [
    new Paragraph({
      spacing: { before: 120, after: 40 },
      children: [
        new TextRun({ text: section.heading, bold: true, size: scaled(1.05) }),
        ...(section.meta
          ? [new TextRun({ text: `   ${section.meta}`, italics: true, size: scaled(0.95) })]
          : []),
      ],
    }),
    // A real list, not a hyphen typed at the start of a line: parsers read the
    // structure, and a reader gets proper indentation.
    ...section.bullets.map(
      (text) => new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 40 } })
    ),
    ...(section.link
      ? [
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: section.link, size: scaled(0.9), color: '555555' })],
          }),
        ]
      : []),
  ];

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: resume.name, bold: true, size: scaled(1.52) })],
    }),
    ...(resume.headline
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: resume.headline, size: scaled(1.05) })],
          }),
        ]
      : []),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: resume.contactLine, size: scaled(0.95) })],
    }),
    ...(resume.linksLine
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: resume.linksLine, size: scaled(0.95) })],
          }),
        ]
      : []),

    ...(resume.summary
      ? [heading(headingText(resume, 'summary')), new Paragraph({ text: resume.summary, spacing: { after: 40 } })]
      : []),

    ...(resume.experience.length > 0
      ? [heading(headingText(resume, 'experience')), ...resume.experience.flatMap(sectionParagraphs)]
      : []),
    ...(resume.projects.length > 0 ? [heading(headingText(resume, 'projects')), ...resume.projects.flatMap(sectionParagraphs)] : []),
    ...(resume.education.length > 0
      ? [heading(headingText(resume, 'education')), ...resume.education.map((line) => new Paragraph({ text: line, spacing: { after: 40 } }))]
      : []),
    ...(resume.certifications.length > 0
      ? [
          heading(headingText(resume, 'certifications')),
          ...resume.certifications.map(
            (line) => new Paragraph({ text: line, bullet: { level: 0 }, spacing: { after: 40 } })
          ),
        ]
      : []),

    ...(resume.languages
      ? [heading(headingText(resume, 'languages')), new Paragraph({ text: resume.languages, spacing: { after: 40 } })]
      : []),

    ...(resume.skills.length > 0
      ? [
          heading(headingText(resume, 'skills')),
          // One line per group, the label bold, so forty terms read as four
          // categories rather than one comma run.
          ...resume.skills.map(
            (group) =>
              new Paragraph({
                spacing: { after: 40 },
                children: [
                  ...(group.label ? [new TextRun({ text: `${group.label}: `, bold: true })] : []),
                  new TextRun({ text: group.items.join(', ') }),
                ],
              })
          ),
        ]
      : []),
  ];

  return children;
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
export async function coverLetterToDocxBlob(
  letter: CoverLetterDocument,
  style = DEFAULT_STYLE
): Promise<Blob> {
  const { Document, Packer } = await import('docx');
  const doc = new Document({
    sections: [{ properties: pageProperties(style), children: await letterParagraphs(letter, style) }],
    styles: documentDefaults(style),
  });
  return Packer.toBlob(doc);
}

/** As `resumeParagraphs`, for the letter. */
async function letterParagraphs(letter: CoverLetterDocument, style: DocumentStyle = DEFAULT_STYLE) {
  const { Paragraph, TextRun, AlignmentType } = await import('docx');

  const line = (text: string, options: { bold?: boolean; after?: number; right?: boolean } = {}) =>
    new Paragraph({
      alignment: options.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { after: options.after ?? 0 },
      children: [new TextRun({ text, bold: options.bold, size: halfPoints(style.size) })],
    });

  const last = (index: number, list: unknown[], gap: number) => (index === list.length - 1 ? gap : 0);

  return [
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
  ];
}


/**
 * The letter and the resume as one file, letter first, page break between.
 *
 * Plenty of postings have exactly one upload slot and no second field for a
 * cover letter - the Enpal form is one. Attaching only the resume throws the
 * letter away; attaching only the letter throws the resume away. Combining
 * them is what people already do by hand, and it is the only thing that fits.
 */
export async function combinedToDocxBlob(
  resume: ResumeDocument,
  letter: CoverLetterDocument,
  style = DEFAULT_STYLE
): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, PageBreak } = await import('docx');
  const [letterChildren, resumeChildren] = await Promise.all([
    letterParagraphs(letter, style),
    resumeParagraphs(resume, style),
  ]);

  const doc = new Document({
    sections: [
      {
        properties: pageProperties(style),
        children: [
          ...letterChildren,
          new Paragraph({ children: [new PageBreak()] }),
          ...resumeChildren,
        ],
      },
    ],
    styles: documentDefaults(style),
  });

  return Packer.toBlob(doc);
}

/** `Jordan_Avery_Application_Enpal.docx` - one file, both documents. */
export function combinedFilename(document: ResumeDocument, company: string): string {
  return [safe(document.name), 'Application', safe(company)].filter(Boolean).join('_') + '.docx';
}

/** Companion to `resumeFilename`, so the pair sit together in the folder. */
export function coverLetterFilename(document: ResumeDocument, company: string): string {
  return [safe(document.name), 'CoverLetter', safe(company)].filter(Boolean).join('_') + '.docx';
}
