/**
 * How the document is set: typeface, size, leading, margins.
 *
 * These were constants in three places — a `font: 'Calibri', size: 21` literal
 * repeated in each of the three export functions, and a matching set of pixel
 * sizes in Review.css. So the preview and the file agreed only because someone
 * kept them in step by hand, and neither could be changed at all.
 *
 * One object now drives both: the export reads it for the `.docx`, and the
 * review page writes it into CSS custom properties that the on-screen page is
 * built from. Changing the typeface changes what prints, and the one-page rule
 * moves with the margin, because it is computed from the same numbers.
 *
 * Everything here is in the units a person thinks in — points and inches — and
 * converted at the edges. Word counts in half-points and twentieths of a point;
 * the screen counts in pixels. Neither belongs in the settings themselves.
 */
export interface DocumentStyle {
  /** Family name as Word knows it. Substituting silently is the reader's problem, so keep to faces Word ships. */
  font: string;
  /** Body size in points. Headings scale from it. */
  size: number;
  /** Line height, as a multiple of the font size. */
  line: number;
  /** Page margin in inches, all four sides. */
  margin: number;
}

export const DEFAULT_STYLE: DocumentStyle = { font: 'Calibri', size: 10.5, line: 1.35, margin: 1 };

/**
 * The faces offered, and what the browser should use to render each.
 *
 * Only faces Word and LibreOffice both ship. A resume set in a font the
 * recipient does not have is re-set by their machine into something else, and
 * the careful page you looked at is not the page they read.
 */
export const FONTS: ReadonlyArray<{ name: string; stack: string }> = [
  { name: 'Calibri', stack: "Calibri, Carlito, 'Segoe UI', sans-serif" },
  { name: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { name: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { name: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif' },
  { name: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  { name: 'Cambria', stack: 'Cambria, Georgia, serif' },
  { name: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
  { name: 'Garamond', stack: "Garamond, 'EB Garamond', Georgia, serif" },
];

export const SIZES = [9, 9.5, 10, 10.5, 11, 11.5, 12];
export const LINE_HEIGHTS = [1, 1.15, 1.35, 1.5, 1.75];
export const MARGINS = [0.5, 0.6, 0.75, 1, 1.25];

export function fontStack(font: string): string {
  return FONTS.find((f) => f.name === font)?.stack ?? FONTS[0]!.stack;
}

/** Word measures type in half-points. */
export const halfPoints = (points: number) => Math.round(points * 2);

/** Word measures everything else in twips: 1440 to the inch. */
export const twips = (inches: number) => Math.round(inches * 1440);

/** Word measures line spacing in 240ths of a line. */
export const lineTwips = (multiple: number) => Math.round(multiple * 240);

/** CSS pixels per inch, for the on-screen page. */
const DPI = 96;

/** A4 at 96dpi. The sheet on screen is this tall, because it is the paper. */
export const A4_HEIGHT_PX = 1123;
export const A4_WIDTH_PX = 794;

export const marginPx = (margin: number) => Math.round(margin * DPI);

/**
 * How much room one page has for content, in the pixels the preview measures.
 *
 * This is what the resume is trimmed against, so it has to move with the
 * margin: going from 1" to 0.6" buys 76px, three or four bullet lines.
 */
export const contentBudgetPx = (margin: number) => A4_HEIGHT_PX - marginPx(margin) * 2;

/** Body size in CSS pixels. 10.5pt is the 14px the page was built at. */
export const sizePx = (points: number) => (points * DPI) / 72;

const KEY = 'documentStyle';

export async function getDocumentStyle(): Promise<DocumentStyle> {
  const stored = await browser.storage.local.get(KEY);
  // Merged over the defaults rather than returned as found: a setting added
  // later would otherwise come back undefined for everyone who had ever saved.
  return { ...DEFAULT_STYLE, ...((stored[KEY] as Partial<DocumentStyle>) ?? {}) };
}

export async function setDocumentStyle(style: DocumentStyle): Promise<void> {
  await browser.storage.local.set({ [KEY]: style });
}
