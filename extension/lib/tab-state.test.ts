import { beforeEach, describe, expect, it } from 'vitest';
import { clearTabState, getTabState, patchTabState, setTabState, type FillResult } from './tab-state';

// A stand-in for `chrome.storage.session`, which jsdom has no notion of. Only
// the three methods tab-state actually calls are implemented.
function fakeArea() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    },
    remove: async (key: string) => {
      delete data[key];
    },
  };
}

let area: ReturnType<typeof fakeArea>;

beforeEach(() => {
  area = fakeArea();
  (globalThis as unknown as { browser: unknown }).browser = { storage: { session: area } };
});

const doneFill = {
  status: 'done',
  filledCount: 3,
  unmatchedCount: 0,
  unmatchedLabels: [],
  unrecognized: [],
  autoAnswered: [],
  hostname: 'boards.greenhouse.io',
} satisfies FillResult;

describe('tab state', () => {
  it('returns an empty state for a tab nothing has been stored for', async () => {
    expect(await getTabState(7)).toEqual({});
  });

  it('keeps each tab separate', async () => {
    await setTabState(1, { fill: doneFill });
    await setTabState(2, { fill: { status: 'error', message: 'nope' } });

    expect((await getTabState(1)).fill).toEqual(doneFill);
    expect((await getTabState(2)).fill).toEqual({ status: 'error', message: 'nope' });
  });

  it('patches one section without disturbing the others', async () => {
    await setTabState(1, { fill: doneFill, attach: { results: { resume: { ok: true } } } });
    await patchTabState(1, { draft: { status: 'running', done: 1, total: 4, entries: [] } });

    const state = await getTabState(1);
    expect(state.fill).toEqual(doneFill);
    expect(state.attach?.results.resume).toEqual({ ok: true });
    expect(state.draft?.done).toBe(1);
  });

  it('patching one tab leaves another alone', async () => {
    await setTabState(1, { fill: doneFill });
    await setTabState(2, { fill: doneFill });
    await patchTabState(1, { fill: { ...doneFill, stale: true } });

    expect((await getTabState(1)).fill).toMatchObject({ stale: true });
    expect((await getTabState(2)).fill).not.toMatchObject({ stale: true });
  });

  it('clears only the tab it was asked to clear', async () => {
    await setTabState(1, { fill: doneFill });
    await setTabState(2, { fill: doneFill });
    await clearTabState(1);

    expect(await getTabState(1)).toEqual({});
    expect((await getTabState(2)).fill).toEqual(doneFill);
  });
});

describe('concurrent writes', () => {
  it('does not let overlapping patches drop each other', async () => {
    await Promise.all([
      patchTabState(1, { fill: doneFill }),
      patchTabState(1, { attach: { results: { resume: { ok: true } } } }),
      patchTabState(1, { draft: { status: 'done', done: 1, total: 1, entries: [] } }),
    ]);

    const state = await getTabState(1);
    expect(state.fill).toBeDefined();
    expect(state.attach).toBeDefined();
    expect(state.draft).toBeDefined();
  });
});
