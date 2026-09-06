import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.hoisted(() => vi.fn());
const runtimeSend = vi.hoisted(() => vi.fn());

vi.stubGlobal('browser', {
  tabs: { sendMessage, query: vi.fn() },
  runtime: { sendMessage: runtimeSend },
});

const { askFrames } = await import('./active-tab');

describe('askFrames', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    runtimeSend.mockReset();
    runtimeSend.mockResolvedValue({ frames: [{ frameId: 3 }, { frameId: 7 }] });
  });

  const hasCompany = (r: { company?: string }) => Boolean(r.company);

  it('skips a frame that answers with nothing', async () => {
    // The top frame of an embedded application replies instantly with an empty
    // answer and would otherwise win the race.
    sendMessage.mockImplementation((_tab, _msg, options) =>
      options?.frameId === 7 ? { company: 'Enpal' } : {}
    );

    expect(await askFrames(1, { type: 'get-job-info' }, hasCompany)).toEqual({ company: 'Enpal' });
  });

  it('asks registered frames before the top frame', async () => {
    sendMessage.mockResolvedValue({});
    await askFrames(1, { type: 'x' }, hasCompany);

    const order = sendMessage.mock.calls.map((call) => call[2]?.frameId ?? null);
    expect(order).toEqual([3, 7, null]);
  });

  it('stops as soon as it has a real answer', async () => {
    sendMessage.mockResolvedValue({ company: 'Enpal' });
    await askFrames(1, { type: 'x' }, hasCompany);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('returns the empty shape rather than null when no frame has anything', async () => {
    // Callers want "no company found", not a null they each have to handle.
    sendMessage.mockResolvedValue({ company: '' });
    expect(await askFrames(1, { type: 'x' }, hasCompany)).toEqual({ company: '' });
  });

  it('still asks the top frame when no frame registered itself', async () => {
    runtimeSend.mockResolvedValue({ frames: [] });
    sendMessage.mockResolvedValue({ company: 'Enpal' });

    expect(await askFrames(1, { type: 'x' }, hasCompany)).toEqual({ company: 'Enpal' });
    expect(sendMessage.mock.calls[0]?.[2]).toEqual({});
  });

  it('survives a frame that has gone', async () => {
    sendMessage.mockImplementation((_tab, _msg, options) => {
      if (options?.frameId === 3) return Promise.reject(new Error('no receiver'));
      return Promise.resolve({ company: 'Enpal' });
    });

    expect(await askFrames(1, { type: 'x' }, hasCompany)).toEqual({ company: 'Enpal' });
  });

  it('returns null when nothing answers at all', async () => {
    sendMessage.mockRejectedValue(new Error('no receiver'));
    expect(await askFrames(1, { type: 'x' }, hasCompany)).toBeNull();
  });
});
