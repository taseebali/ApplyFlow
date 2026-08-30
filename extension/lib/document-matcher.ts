export type DocumentKind = 'resume' | 'coverLetter';

const KEYWORDS: Record<DocumentKind, string[]> = {
  // German forms label these 'Lebenslauf' and 'Anschreiben' (or
  // 'Motivationsschreiben'), and so do the files people save for them.
  resume: ['resume', 'cv', 'lebenslauf'],
  coverLetter: ['cover letter', 'coverletter', 'cover', 'anschreiben', 'motivationsschreiben'],
};

export interface FolderFile {
  name: string;
  handle: FileSystemFileHandle;
  lastModified: number;
}

export async function listFolderFiles(folder: FileSystemDirectoryHandle): Promise<FolderFile[]> {
  const files: FolderFile[] = [];
  for await (const entry of folder.values()) {
    if (entry.kind !== 'file') continue;
    const fileHandle = entry as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    files.push({ name: entry.name, handle: fileHandle, lastModified: file.lastModified });
  }
  return files;
}

export interface DocumentMatchResult {
  file: FolderFile | null;
  /**
   * "company": filename matched the detected company name — high confidence.
   * "most-recent": company name couldn't be detected, so this is just the
   *   newest keyword-matching file — best-effort, should be confirmed by the user.
   * "none": either no keyword-matching file exists, or the company was known
   *   but no file matched it (we don't guess wrong-company in that case).
   */
  matchedBy: 'company' | 'most-recent' | 'none';
}

function newestOf(files: FolderFile[]): FolderFile {
  return [...files].sort((a, b) => b.lastModified - a.lastModified)[0]!;
}

/**
 * A company name shorter than this is not evidence of anything: it is scraped
 * out of the page being applied to, so a hostile posting could name itself "a"
 * and have it match nearly every filename in the folder.
 */
const MIN_COMPANY_TOKEN = 3;

const normalizeName = (value: string) => value.toLowerCase().replace(/[_\-.]+/g, ' ');

function companyTokens(companyName: string): string[] {
  return normalizeName(companyName)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_COMPANY_TOKEN);
}

/**
 * Whole-token match, not a substring: "acme" should match `resume-acme.pdf`
 * but "a" should match nothing, and "cv" should not make `discover.pdf` a
 * candidate.
 */
function nameContainsToken(fileName: string, token: string): boolean {
  return normalizeName(fileName)
    .split(/[^a-z0-9]+/)
    .includes(token);
}

export function findBestMatch(
  files: FolderFile[],
  kind: DocumentKind,
  companyName: string | null
): DocumentMatchResult {
  const keywords = KEYWORDS[kind];
  // Whole words only. A plain substring test makes `discover-statement.pdf` a
  // resume ("cv") and `recovery-codes.txt` a cover letter ("cover"), which is
  // how an unrelated private file ends up one click from an upload field.
  const candidates = files.filter((f) => {
    const name = normalizeName(f.name);
    return keywords.some((k) => new RegExp(`(^| )${k}( |$)`).test(name));
  });

  if (candidates.length === 0) return { file: null, matchedBy: 'none' };

  if (companyName) {
    const tokens = companyTokens(companyName);
    // Nothing usable in the scraped name — fall through to the newest file,
    // which the user has to confirm, rather than treating it as a match.
    if (tokens.length === 0) return { file: newestOf(candidates), matchedBy: 'most-recent' };

    const companyMatches = candidates.filter((f) => tokens.every((t) => nameContainsToken(f.name, t)));
    if (companyMatches.length > 0) {
      return { file: newestOf(companyMatches), matchedBy: 'company' };
    }
    // Known company, but nothing matched it by filename — don't guess wrong.
    return { file: null, matchedBy: 'none' };
  }

  return { file: newestOf(candidates), matchedBy: 'most-recent' };
}
