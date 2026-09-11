import { listRecords, putRecord } from './application-db';
import { emptyRecord, type ApplicationRecord } from './application-record';

/**
 * Moves the old `storage.local` log into IndexedDB, once.
 *
 * The old entries carry counts and nothing else — no job description, no
 * documents, no bullet ids, because none of that was recorded. Those fields
 * stay empty rather than being filled with defaults: a dashboard that shows an
 * invented score is worse than one that shows a blank.
 *
 * The old key is removed only after the write succeeds, so an interrupted
 * migration leaves the original data where it was.
 */
export const LEGACY_KEY = 'application-log';

interface LegacyEntry {
  id: string;
  appliedAt: number;
  company: string;
  title: string;
  url: string;
  hostname: string;
  filledCount: number;
  invalidCount: number;
  questionsDrafted: number;
  documentsAttached: number;
}

export async function migrateApplicationLog(): Promise<number> {
  const stored = await browser.storage.local.get(LEGACY_KEY);
  const entries = stored[LEGACY_KEY] as LegacyEntry[] | undefined;
  if (!Array.isArray(entries) || entries.length === 0) return 0;

  const existing = new Set((await listRecords()).map((r) => r.id));

  let moved = 0;
  for (const entry of entries) {
    if (existing.has(entry.id)) continue;
    const record: ApplicationRecord = {
      ...emptyRecord({
        company: entry.company,
        title: entry.title,
        url: entry.url,
        hostname: entry.hostname,
      }),
      id: entry.id,
      appliedAt: entry.appliedAt,
      filledCount: entry.filledCount ?? 0,
      invalidCount: entry.invalidCount ?? 0,
      questionsDrafted: entry.questionsDrafted ?? 0,
      documentsAttached: entry.documentsAttached ?? 0,
    };
    await putRecord(record);
    moved += 1;
  }

  await browser.storage.local.remove(LEGACY_KEY);
  return moved;
}
