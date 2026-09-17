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

function fakeChrome(behaviour: { lastError?: string; response?: unknown; silent?: boolean }) {
  const runtime = {
    lastError: undefined as { message: string } | undefined,
    sendMessage: (_id: string, _request: unknown, callback: Callback) => {
      if (behaviour.silent) return;
      runtime.lastError = behaviour.lastError ? { message: behaviour.lastError } : undefined;
      callback(behaviour.response);
    },
  };
  (globalThis as { chrome?: unknown }).chrome = { runtime };
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.useRealTimers();
});

describe('askExtension', () => {
  it('says the browser cannot ask when there is no runtime at all', async () => {
    delete (globalThis as { chrome?: unknown }).chrome;
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

  it('separates a refusal from an absence, because they ask different things of the reader', async () => {
    fakeChrome({ response: { ok: false, error: 'Not an allowed origin.' } });
    await expect(askExtension({ type: 'list' })).rejects.toMatchObject({ state: { kind: 'refused' } });
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
