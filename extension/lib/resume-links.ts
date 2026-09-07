/**
 * Keeping a hyperlink attached to the line it was on.
 *
 * A resume prints "Live Demo" or "GitHub" and hides the address behind it, so
 * the address is the only part worth importing and the visible word is the
 * only part that survived. Two different failures produced the same symptom:
 *
 *  - `.docx` went through mammoth's `extractRawText`, which drops hyperlinks
 *    entirely. "Live Demo" arrived as the words "Live Demo", and that is what
 *    landed in the project's Link field.
 *  - `.pdf` did read the annotation layer, but appended every URL as a flat
 *    list at the end of the document. A project then got no link at all, or
 *    whichever link happened to match first — which is why one project came
 *    out carrying the profile's GitHub address instead of its own repository.
 *
 * Both are fixed the same way: put the URL next to the text it belonged to,
 * in parentheses, and let the parser read it as part of that line.
 */

/** Bare "github.com/x" and "www.x.com" are addresses; a resume just writes them short. */
export function normalizeUrl(raw: string): string {
  const url = raw.trim().replace(/[),.;]+$/, '');
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (/^mailto:/i.test(url)) return url;
  // Only where it is unambiguously a web address. Prefixing anything with a
  // dot in it would turn "Node.js" into a link.
  if (/^www\./i.test(url) || /^[a-z0-9-]+\.(com|org|net|io|dev|me|co|ai|app|xyz)(\/|$)/i.test(url)) {
    return `https://${url}`;
  }
  return url;
}

/**
 * Turns mammoth's HTML into the plain text the parser expects, with each
 * anchor's address written beside its text.
 *
 * Uses DOMParser rather than a regex: mammoth emits nested markup, and a
 * regex over HTML is the classic way to lose half a document to one unusual
 * attribute.
 */
export function htmlToTextWithLinks(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');

  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    const href = normalizeUrl(anchor.getAttribute('href') ?? '');
    const text = (anchor.textContent ?? '').trim();
    if (!href) continue;
    // A link whose text is already the address needs no parenthesis after it.
    anchor.textContent = !text || normalizeUrl(text) === href ? href : `${text} (${href})`;
  }

  // Block elements are the only line structure the HTML carries, and the
  // section headings the parser looks for depend on it.
  for (const block of Array.from(document.querySelectorAll('p, li, br, h1, h2, h3, h4, div, tr'))) {
    block.append('\n');
  }

  return document.body.textContent ?? '';
}

export interface PdfLine {
  text: string;
  /** Baseline y in PDF user space, which counts up from the bottom of the page. */
  y: number;
}

export interface PdfLink {
  url: string;
  /** [x1, y1, x2, y2] in the same space as the lines. */
  rect: [number, number, number, number];
}

/**
 * Writes each link onto the line it sits on.
 *
 * Matched by vertical position: an annotation's rectangle spans the line it
 * covers, and a resume's links are on the line they describe. A link that
 * matches no line is appended at the end rather than dropped — losing an
 * address is worse than printing it in the wrong place, and the parser treats
 * a trailing bare URL as belonging to nothing in particular.
 */
export function attachPdfLinks(lines: PdfLine[], links: PdfLink[]): string {
  const out = lines.map((line) => line.text);
  const orphans: string[] = [];

  for (const link of links) {
    const url = normalizeUrl(link.url);
    if (!url) continue;

    const [, bottom, , top] = link.rect;
    // Half a line of slack: an annotation rectangle is usually a little taller
    // than the glyphs, but not always, and an exact containment test misses
    // links whose baseline sits a point outside the box.
    const index = lines.findIndex((line) => line.y >= bottom - 2 && line.y <= top + 2);

    if (index === -1) {
      if (!orphans.includes(url)) orphans.push(url);
      continue;
    }
    // Already written out in full on that line — a resume that prints the
    // address and links it too should not print it twice.
    if (out[index]!.includes(url)) continue;
    out[index] = `${out[index]} (${url})`;
  }

  return [...out, ...orphans].join('\n');
}
