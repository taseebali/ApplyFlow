import { readJobInfo } from './active-tab';
import { getRecord, putRecord } from './application-db';
import { recordForFill, type FillOutcome } from './application-record';
import { getTabState, patchTabState } from './tab-state';

/**
 * Writes what a fill did into this tab's application record.
 *
 * The only place a record is created, so the two fill paths cannot disagree
 * about what a record looks like or about when a new one is due. The tab's
 * `applicationId` is the posting's identity: the background worker clears the
 * tab's state when the tab moves to a *different* posting, so an id that is
 * still there means the same application, and re-filling it adds to the
 * record that already carries its documents and score rather than starting a
 * second one.
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
  // documents and score — patches against.
  if (!existing) await patchTabState(tabId, { applicationId: record.id });
}
