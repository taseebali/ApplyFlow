import { describe, expect, it } from 'vitest';
import { assembleCoverLetter, assembleResume, combinedFilename, combinedToDocxBlob } from './resume-document';
import { EMPTY_PROFILE, type Profile } from './schema';

const profile: Profile = {
  ...EMPTY_PROFILE,
  contact: { ...EMPTY_PROFILE.contact, firstName: 'Jordan', lastName: 'Avery', city: 'Berlin' },
  summary: 'Builds agent systems, not prompt demos.',
  skills: ['Languages: Python, SQL'],
  projects: [
    {
      id: 'p1',
      name: 'Repo Triage Agent',
      role: '',
      bullets: [{ id: 'b', text: 'Evaluated against 10 verified fixes at a 90% file-match rate.' }],
      techStack: 'Python, FastAPI',
      outcomes: '',
    },
  ],
};

describe('the combined document', () => {
  const resume = assembleResume(profile, []);
  const letter = assembleCoverLetter({
    profile,
    company: 'Enpal',
    role: 'AI Engineer',
    body: 'First paragraph.\n\nSecond paragraph.',
    language: 'en',
    today: new Date('2026-09-07T12:00:00Z'),
  });

  it('is named as one application, not as a resume', () => {
    expect(combinedFilename(resume, 'Enpal')).toBe('Jordan_Avery_Application_Enpal.docx');
  });

  it('produces a real .docx containing both documents', async () => {
    const blob = await combinedToDocxBlob(resume, letter);
    expect(blob.size).toBeGreaterThan(2000);

    // A .docx is a zip; PK is its magic number. Anything else is not a file
    // Word will open. jsdom's Blob has no arrayBuffer(), hence Response.
    const bytes = new Uint8Array(await bufferOf(blob));
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe('PK');
  });

  it('puts the letter before the resume, separated by a page break', async () => {
    const blob = await combinedToDocxBlob(resume, letter);
    const xml = await unzipDocument(await bufferOf(blob));

    const subject = xml.indexOf('Application for AI Engineer');
    const pageBreak = xml.indexOf('w:br w:type="page"');
    const projects = xml.indexOf('Repo Triage Agent');

    expect(subject).toBeGreaterThan(-1);
    expect(pageBreak).toBeGreaterThan(subject);
    expect(projects).toBeGreaterThan(pageBreak);
  });
});

/**
 * jsdom's Blob implements neither arrayBuffer() nor interop with undici's
 * Response, which reads it as a string and corrupts the bytes. FileReader is
 * the one path jsdom does implement.
 */
function bufferOf(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** A .docx is a zip. jszip already ships inside `docx`, so this costs nothing. */
async function unzipDocument(buffer: ArrayBuffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}
