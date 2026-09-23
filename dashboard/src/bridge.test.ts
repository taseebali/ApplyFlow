import { afterEach, describe, expect, it, vi } from 'vitest';
import { askExtension, stateFor, wordingOutcomes, type TransferableRecord } from './bridge';

const record = (over: Partial<TransferableRecord>): TransferableRecord =>
  ({
    id: 'x',
    appliedAt: 0,
    company: 'Enpal',
    title: 'AI Intern',
    url: '',
    hostname: '',
    status: 'applied',
    priority: 'none',
    tags: [],
    nextAction: '',
    nextActionAt: null,
    salary: '',
    filledCount: 0,
    invalidCount: 0,
    questionsDrafted: 0,
    documentsAttached: 0,
    jobDescription: '',
    matchScore: null,
    gapCovered: [],
    gapMissing: [],
    variantIds: [],
    estimatedFigures: [],
    requestsSpent: 0,
    resume: null,
    coverLetter: null,
    ...over,
  }) as TransferableRecord;

describe('wordingOutcomes', () => {
  it('counts a send per application and a reply for anything past applied', () => {
    const outcomes = wordingOutcomes([
      record({ variantIds: ['a', 'b'], status: 'interview' }),
      record({ variantIds: ['a'], status: 'applied' }),
    ]);
    expect(outcomes).toEqual([
      { variantId: 'a', sent: 2, replied: 1 },
      { variantId: 'b', sent: 1, replied: 1 },
    ]);
  });

  it('ranks by replies rather than by rate, so one lucky send does not lead', () => {
    const lucky = record({ variantIds: ['lucky'], status: 'offer' });
    const proven = [1, 2, 3, 4, 5].map((n) =>
      record({ id: `p${n}`, variantIds: ['proven'], status: n <= 3 ? 'replied' : 'applied' })
    );
    expect(wordingOutcomes([lucky, ...proven])[0]!.variantId).toBe('proven');
  });
});

/*
 * The connection states. Each one sends the reader somewhere different, so a
 * wrong classification is a wrong instruction — worth testing even though the
 * only way to produce them is a fake `chrome`.
 */

type Callback = (response?: unknown) => void;

/**
 * The dashboard only ever runs as an extension page now, so the stub has to
 * look like one: an id on `chrome.runtime`, a chrome-extension: protocol, and
 * `sendMessage(request, callback)` with no extension id in front of it.
 */
function fakeChrome(behaviour: { lastError?: string; response?: unknown; silent?: boolean }) {
  // The tests run in node, which has no `location`; the page always has one,
  // and its protocol is half of what says this is an extension page.
  vi.stubGlobal('location', { protocol: 'chrome-extension:' });
  const runtime = {
    id: 'jlfojkgndajebhpbcegdimapokhjpdik',
    lastError: undefined as { message: string } | undefined,
    sendMessage: (_request: unknown, callback: Callback) => {
      if (behaviour.silent) return;
      runtime.lastError = behaviour.lastError ? { message: behaviour.lastError } : undefined;
      callback(behaviour.response);
    },
  };
  (globalThis as { chrome?: unknown }).chrome = { runtime };
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('askExtension', () => {
  it('says the browser cannot ask when there is no runtime at all', async () => {
    delete (globalThis as { chrome?: unknown }).chrome;
    await expect(askExtension({ type: 'list' })).rejects.toMatchObject({ state: { kind: 'no-runtime' } });
  });

  it('refuses to ask at all when served from somewhere that is not the extension', async () => {
    // The dev server is the case: a page there has no chrome.runtime.id, and
    // pretending otherwise is what used to end in "ApplyFlow refused this
    // page" — an error about an allowlist that no longer exists.
    fakeChrome({ response: { ok: true, records: [] } });
    (globalThis as { chrome?: { runtime: { id?: string } } }).chrome!.runtime.id = undefined;
    await expect(askExtension({ type: 'list' })).rejects.toMatchObject({ state: { kind: 'no-runtime' } });
  });

  it('reads Chrome\'s "receiving end does not exist" as nothing being installed', async () => {
    // Chrome has no error codes here, only this sentence — and it is the same
    // one whether ApplyFlow is missing, switched off, or a release build.
    fakeChrome({ lastError: 'Could not establish connection. Receiving end does not exist.' });
    await expect(askExtension({ type: 'list' })).rejects.toMatchObject({
      state: { kind: 'not-installed' },
    });
  });

  it('does not read an ordinary failure as a refusal', async () => {
    fakeChrome({ response: { ok: false, error: 'Could not read applications.' } });
    const response = await askExtension({ type: 'list' });
    expect(response).toEqual({ ok: false, error: 'Could not read applications.' });
  });

  it('gives up rather than hanging when a dead worker never calls back', async () => {
    vi.useFakeTimers();
    fakeChrome({ silent: true });
    const pending = askExtension({ type: 'list' });
    const assertion = expect(pending).rejects.toMatchObject({ state: { kind: 'unreachable' } });
    await vi.advanceTimersByTimeAsync(7_000);
    await assertion;
  });

  it('resolves a good answer', async () => {
    fakeChrome({ response: { ok: true, records: [] } });
    await expect(askExtension({ type: 'list' })).resolves.toEqual({ ok: true, records: [] });
  });
});

describe('stateFor', () => {
  it('turns anything it does not recognise into unreachable rather than throwing again', () => {
    expect(stateFor(new Error('boom'))).toEqual({ kind: 'unreachable' });
    expect(stateFor(undefined)).toEqual({ kind: 'unreachable' });
  });
});
