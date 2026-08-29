import { describe, expect, it } from 'vitest';
import { findBestMatch, type FolderFile } from './document-matcher';

const file = (name: string, lastModified = 1): FolderFile => ({
  name,
  lastModified,
  handle: {} as FileSystemFileHandle,
});

const FOLDER = [
  file('Jordan-Ali-resume-acme.pdf', 300),
  file('Jordan-Ali-resume.pdf', 200),
  file('cover-letter-acme.pdf', 100),
  file('recovery-codes.txt', 400),
  file('discover-statement.pdf', 500),
  file('tax-return-2025.pdf', 600),
];

describe('findBestMatch', () => {
  it('prefers the file naming the company', () => {
    const match = findBestMatch(FOLDER, 'resume', 'Acme');
    expect(match.matchedBy).toBe('company');
    expect(match.file?.name).toBe('Jordan-Ali-resume-acme.pdf');
  });

  it('falls back to the newest keyword match when no company is known', () => {
    const match = findBestMatch(FOLDER, 'resume', null);
    expect(match.matchedBy).toBe('most-recent');
    expect(match.file?.name).toBe('Jordan-Ali-resume-acme.pdf');
  });

  it('does not guess a different company than the one detected', () => {
    expect(findBestMatch(FOLDER, 'resume', 'Globex')).toEqual({ file: null, matchedBy: 'none' });
  });

  // The company name is scraped from the page being applied to, so it is
  // attacker-controlled. A short or punctuation-only one must never produce the
  // high-confidence 'company' verdict, which is what the UI treats as certain.
  it.each(['a', 'ac', '.', '   ', '-'])('treats %o as no company evidence at all', (company) => {
    expect(findBestMatch(FOLDER, 'resume', company).matchedBy).not.toBe('company');
  });

  it('matches company names on whole tokens, not substrings', () => {
    // "cm" sits inside "acme" but is not a token of the filename.
    expect(findBestMatch(FOLDER, 'resume', 'cm').matchedBy).not.toBe('company');
  });

  it('never treats an unrelated private file as a document candidate', () => {
    const noise = [file('recovery-codes.txt'), file('discover-statement.pdf'), file('tax-return-2025.pdf')];
    expect(findBestMatch(noise, 'resume', null)).toEqual({ file: null, matchedBy: 'none' });
    expect(findBestMatch(noise, 'coverLetter', null)).toEqual({ file: null, matchedBy: 'none' });
  });

  it('still recognises the ordinary naming conventions', () => {
    expect(findBestMatch([file('my cv.pdf')], 'resume', null).file?.name).toBe('my cv.pdf');
    expect(findBestMatch([file('Cover_Letter_Final.docx')], 'coverLetter', null).file?.name).toBe(
      'Cover_Letter_Final.docx'
    );
  });
});
