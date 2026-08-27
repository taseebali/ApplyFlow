/** A file format we know how to read text out of. */
export type ResumeFormat = 'pdf' | 'docx' | 'text';

export class ResumeTextError extends Error {}

export function detectResumeFormat(fileName: string): ResumeFormat | null {
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'docx') return 'docx';
  if (extension === 'txt' || extension === 'md') return 'text';
  return null;
}

/**
 * Blob.arrayBuffer() is not implemented everywhere the parser needs to run
 * (notably jsdom, where the tests live), so fall back to FileReader.
 */
function readArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * PDF text items carry no line structure of their own — joining them naively
 * collapses a resume onto one line and defeats every section-header heuristic.
 * pdf.js marks the end of a visual line with `hasEOL`, so honour that.
 */
function joinPdfTextItems(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  let out = '';
  for (const item of items) {
    out += item.str ?? '';
    out += item.hasEOL ? '\n' : ' ';
  }
  return out;
}

async function extractPdfText(file: File): Promise<string> {
  // Loaded on demand: pdf.js is large and is needed only during onboarding,
  // so keeping it out of the side panel's main chunk matters more than the
  // one-off cost of importing it here.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // pdf.js needs a real worker in the browser. Left unset it tries to build a
  // "fake worker" by evaluating code at runtime, which the extension's CSP
  // blocks — so point it at the worker bundled beside us as an asset.
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await readArrayBuffer(file)),
    isEvalSupported: false,
    useWorkerFetch: false,
    useSystemFonts: false,
  }).promise;

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(joinPdfTextItems(content.items as Array<{ str?: string; hasEOL?: boolean }>));
  }
  return pages.join('\n\n');
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: await readArrayBuffer(file) });
  return result.value;
}

/** Decoded from bytes rather than `file.text()`, which is not available everywhere. */
async function extractPlainText(file: File): Promise<string> {
  return new TextDecoder().decode(await readArrayBuffer(file));
}

/** Normalizes whitespace without destroying the line breaks the parser relies on. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Reads a resume file as plain text. Throws a message worth showing the user
 * rather than returning empty text, since a silent empty result is
 * indistinguishable from a broken import.
 */
export async function extractResumeText(file: File): Promise<string> {
  const format = detectResumeFormat(file.name);
  if (!format) {
    throw new ResumeTextError(
      `Can't read "${file.name}". Use a PDF, Word (.docx), or plain text file.`
    );
  }

  let raw: string;
  try {
    if (format === 'pdf') raw = await extractPdfText(file);
    else if (format === 'docx') raw = await extractDocxText(file);
    else raw = await extractPlainText(file);
  } catch (err) {
    // Always carry the underlying reason through. A generic "damaged file"
    // message sends the user hunting for a problem in a file that is fine,
    // when the real fault is usually ours.
    const reason = err instanceof Error ? err.message : String(err);
    const passwordProtected = /password/i.test(reason);
    throw new ResumeTextError(
      passwordProtected
        ? `"${file.name}" is password-protected. Save an unlocked copy and try again.`
        : `Couldn't read "${file.name}": ${reason}`,
      { cause: err }
    );
  }

  const text = tidy(raw);
  if (!text) {
    throw new ResumeTextError(
      `"${file.name}" has no text in it. If it's a scanned PDF, export a text-based copy and try again.`
    );
  }
  return text;
}
