import { describe, expect, it } from 'vitest';
import { detectResumeFormat, extractResumeText, ResumeTextError } from './resume-text';

describe('detectResumeFormat', () => {
  it('recognizes the formats we can read', () => {
    expect(detectResumeFormat('resume.pdf')).toBe('pdf');
    expect(detectResumeFormat('resume.docx')).toBe('docx');
    expect(detectResumeFormat('resume.txt')).toBe('text');
    expect(detectResumeFormat('notes.md')).toBe('text');
  });

  it('is case-insensitive and tolerates dots in the name', () => {
    expect(detectResumeFormat('Jordan Avery - Resume.PDF')).toBe('pdf');
    expect(detectResumeFormat('resume.v2.final.docx')).toBe('docx');
  });

  it('returns null for formats we cannot read', () => {
    expect(detectResumeFormat('resume.doc')).toBeNull();
    expect(detectResumeFormat('resume.pages')).toBeNull();
    expect(detectResumeFormat('scan.png')).toBeNull();
    expect(detectResumeFormat('resume')).toBeNull();
  });
});

describe('extractResumeText', () => {
  it('reads a plain text file and normalizes whitespace without losing line breaks', async () => {
    const file = new File(['Jordan   Avery\r\n\r\n\r\n\r\nEXPERIENCE  \n  Engineer '], 'cv.txt');
    await expect(extractResumeText(file)).resolves.toBe('Jordan Avery\n\nEXPERIENCE\nEngineer');
  });

  it('names the problem when the format is unsupported', async () => {
    const file = new File(['x'], 'resume.doc');
    await expect(extractResumeText(file)).rejects.toBeInstanceOf(ResumeTextError);
    await expect(extractResumeText(file)).rejects.toThrow(/resume\.doc/);
  });

  it('rejects a file with no text rather than importing nothing', async () => {
    const file = new File(['   \n\n  '], 'empty.txt');
    await expect(extractResumeText(file)).rejects.toThrow(/no text in it/);
  });
});
