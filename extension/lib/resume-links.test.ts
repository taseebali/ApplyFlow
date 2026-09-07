import { describe, expect, it } from 'vitest';
import { attachPdfLinks, htmlToTextWithLinks, normalizeUrl, type PdfLine } from './resume-links';

describe('normalizeUrl', () => {
  it('adds the scheme a resume leaves off', () => {
    expect(normalizeUrl('github.com/jordanavery/verdict')).toBe('https://github.com/jordanavery/verdict');
    expect(normalizeUrl('www.example.com')).toBe('https://www.example.com');
  });

  it('leaves an address that already has one alone', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
  });

  it('does not turn a library name into a link', () => {
    // "Node.js" and "scikit-learn" appear in every tech stack on the page.
    expect(normalizeUrl('Node.js')).toBe('Node.js');
    expect(normalizeUrl('asyncio')).toBe('asyncio');
  });

  it('drops the punctuation a sentence leaves on the end', () => {
    expect(normalizeUrl('https://example.com/repo).')).toBe('https://example.com/repo');
  });
});

describe('htmlToTextWithLinks', () => {
  it('writes the address beside the words that hid it', () => {
    // The reported bug: "Live Demo" arrived as the words "Live Demo", because
    // extractRawText discards the href entirely.
    const text = htmlToTextWithLinks('<p>VERDICT — <a href="https://verdict.app">Live Demo</a></p>');
    expect(text).toContain('Live Demo (https://verdict.app)');
  });

  it('keeps a link on the line of the project it belongs to', () => {
    const text = htmlToTextWithLinks(
      '<p>RAG System</p><p>Repo: <a href="https://github.com/me/rag">github</a></p><p>Knight\'s Tour</p>'
    );
    const lines = text.split('\n').filter(Boolean);
    expect(lines[1]).toContain('github.com/me/rag');
    expect(lines[2]).toBe("Knight's Tour");
  });

  it('does not print an address twice when the text already is the address', () => {
    const text = htmlToTextWithLinks('<p><a href="https://example.com">https://example.com</a></p>');
    expect(text.match(/example\.com/g)).toHaveLength(1);
  });

  it('adds the scheme to a bare href', () => {
    expect(htmlToTextWithLinks('<p><a href="github.com/me">code</a></p>')).toContain('https://github.com/me');
  });

  it('keeps list items on separate lines, which is what section detection reads', () => {
    const text = htmlToTextWithLinks('<ul><li>Built a thing</li><li>Built another</li></ul>');
    expect(text.split('\n').filter(Boolean)).toEqual(['Built a thing', 'Built another']);
  });
});

describe('attachPdfLinks', () => {
  // A page counts y up from the bottom, so the first line has the highest y.
  const lines: PdfLine[] = [
    { text: 'Repo Triage Agent', y: 700 },
    { text: 'RAG System', y: 600 },
    { text: "Knight's Tour", y: 500 },
  ];

  it('puts each link on the line it sits on', () => {
    const text = attachPdfLinks(lines, [
      { url: 'https://github.com/me/rag', rect: [400, 594, 500, 608] },
      { url: 'https://github.com/me/triage', rect: [400, 694, 500, 708] },
    ]);
    const out = text.split('\n');
    expect(out[0]).toBe('Repo Triage Agent (https://github.com/me/triage)');
    expect(out[1]).toBe('RAG System (https://github.com/me/rag)');
    expect(out[2]).toBe("Knight's Tour");
  });

  it('no longer hands every project the same address', () => {
    // The old behaviour appended all URLs at the end, so a project took
    // whichever one matched first — usually the profile GitHub.
    const text = attachPdfLinks(lines, [{ url: 'https://github.com/jordanavery', rect: [50, 694, 200, 708] }]);
    expect(text.split('\n')[1]).toBe('RAG System');
  });

  it('keeps a link that matches no line rather than losing it', () => {
    const text = attachPdfLinks(lines, [{ url: 'https://example.com', rect: [0, 20, 100, 34] }]);
    expect(text.split('\n').at(-1)).toBe('https://example.com');
  });

  it('does not repeat an address the line already prints', () => {
    const printed: PdfLine[] = [{ text: 'Repo: https://github.com/me/rag', y: 700 }];
    const text = attachPdfLinks(printed, [{ url: 'https://github.com/me/rag', rect: [0, 694, 300, 708] }]);
    expect(text).toBe('Repo: https://github.com/me/rag');
  });
});
