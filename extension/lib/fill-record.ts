import { readJobInfo } from './active-tab';
import { getRecord, putRecord } from './application-db';
import { recordForFill, type FillOutcome } from './application-record';
import { getTabState, patchTabState } from './tab-state';

/**
 * Writes what a fill did into this tab's application record.
 *
 * The only place a record is created, so the two fill paths cannot disagree
 * about what a record looks like. What guarantees identity is not the tab's
 * `applicationId` — the background worker is supposed to clear it when the
 * tab moves to a different posting, but an iframe-embedded application and a
 * URL `isJobUrl` doesn't recognise both skip that clear. It is `recordForFill`
 * comparing `info.jobUrl` against the URL the existing record was filed
 * under: a stale `applicationId` pointing at the wrong posting is caught
 * there and a fresh record is started, whatever this tab's state still says.
 *
 * Never allowed to fail a fill — the form is already filled by the time this
 * runs, and a history write is not worth reporting as a failed fill.
 */
export async function saveFillToRecord(tabId: number, outcomes: FillOutcome[]): Promise<void> {
  if (outcomes.length === 0) return;

  const state = await getTabState(tabId);
  const existing = state.applicationId ? await getRecord(state.applicationId) : null;
  const info = await readJobInfo(tabId).catch(() => null);

  const record = recordForFill(
    { company: info?.companyName ?? '', title: info?.jobTitle ?? '', url: info?.jobUrl ?? '' },
    outcomes,
    existing
  );

  await putRecord(record);
  // The id is what every later stage — attach, drafting, the review page's
  // documents and score — patches against. Compared by id rather than
  // `!existing`: recordForFill hands back a new id whenever it decided this
  // is a different posting than `existing` was, even though `existing` was
  // not null.
  if (record.id !== existing?.id) await patchTabState(tabId, { applicationId: record.id });
}
