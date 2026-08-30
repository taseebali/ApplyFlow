import { describe, expect, it } from 'vitest';
import { frameHasWork, mergeFillResults, rankFrames, summarizeFrame, type FrameReport } from './frames';

function docWith(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe('summarizeFrame', () => {
  it('counts fillable fields, ignoring buttons and hidden inputs', () => {
    const report = summarizeFrame(
      docWith(`
        <input type="text"><input type="email">
        <input type="hidden"><input type="submit"><button>Go</button>
      `)
    );
    expect(report.fieldCount).toBe(2);
  });

  it('counts file inputs separately, since they drive the attach path', () => {
    const report = summarizeFrame(docWith('<input type="file"><input type="text">'));
    expect(report.fileInputCount).toBe(1);
    expect(report.fieldCount).toBe(1);
  });

  it('counts textareas as open questions as well as fields', () => {
    const report = summarizeFrame(docWith('<textarea></textarea><input type="text">'));
    expect(report.questionCount).toBe(1);
    expect(report.fieldCount).toBe(2);
  });

  it('reports nothing for a frame with no form at all', () => {
    expect(summarizeFrame(docWith('<p>An advert.</p>'))).toEqual({
      fieldCount: 0,
      fileInputCount: 0,
      questionCount: 0,
    });
  });
});

describe('frameHasWork', () => {
  it('ignores a frame with a single field, which is usually a search box', () => {
    expect(frameHasWork({ fieldCount: 1, fileInputCount: 0, questionCount: 0 })).toBe(false);
  });

  it('accepts a real form', () => {
    expect(frameHasWork({ fieldCount: 2, fileInputCount: 0, questionCount: 0 })).toBe(true);
  });

  it('accepts an upload-only frame', () => {
    expect(frameHasWork({ fieldCount: 0, fileInputCount: 1, questionCount: 0 })).toBe(true);
  });

  it('ignores an empty advertising frame', () => {
    expect(frameHasWork({ fieldCount: 0, fileInputCount: 0, questionCount: 0 })).toBe(false);
  });
});

describe('rankFrames', () => {
  const frame = (over: Partial<FrameReport>): FrameReport => ({
    frameId: 0,
    url: 'https://example.com',
    fieldCount: 0,
    fileInputCount: 0,
    questionCount: 0,
    ...over,
  });

  it('puts the richest form first', () => {
    const ranked = rankFrames([
      frame({ frameId: 1, fieldCount: 3 }),
      frame({ frameId: 2, fieldCount: 20 }),
    ]);
    expect(ranked.map((f) => f.frameId)).toEqual([2, 1]);
  });

  it('drops frames with nothing to do, so ad iframes are never touched', () => {
    const ranked = rankFrames([frame({ frameId: 0, fieldCount: 0 }), frame({ frameId: 5, fieldCount: 9 })]);
    expect(ranked.map((f) => f.frameId)).toEqual([5]);
  });

  it('keeps every qualifying frame, not just the best one', () => {
    // A form in one frame and an upload widget in another is a real layout;
    // filling only the larger would silently skip the attachment.
    const ranked = rankFrames([frame({ frameId: 1, fieldCount: 12 }), frame({ frameId: 2, fileInputCount: 2 })]);
    expect(ranked).toHaveLength(2);
  });

  it('breaks a tie by question count, then by frame id', () => {
    const ranked = rankFrames([
      frame({ frameId: 7, fieldCount: 4, questionCount: 0 }),
      frame({ frameId: 3, fieldCount: 4, questionCount: 2 }),
      frame({ frameId: 1, fieldCount: 4, questionCount: 0 }),
    ]);
    expect(ranked.map((f) => f.frameId)).toEqual([3, 1, 7]);
  });
});

describe('mergeFillResults', () => {
  it('sums across frames so the panel shows one honest total', () => {
    const merged = mergeFillResults([
      { filledCount: 8, unmatchedCount: 1, unmatchedLabels: ['A'], unrecognized: [{ a: 1 }] },
      { filledCount: 3, unmatchedCount: 2, unmatchedLabels: ['B', 'C'], unrecognized: [] },
    ]);
    expect(merged.filledCount).toBe(11);
    expect(merged.unmatchedCount).toBe(3);
    expect(merged.unmatchedLabels).toEqual(['A', 'B', 'C']);
    expect(merged.unrecognized).toHaveLength(1);
  });

  it('is empty rather than undefined when no frame answered', () => {
    expect(mergeFillResults([])).toEqual({
      filledCount: 0,
      unmatchedCount: 0,
      unmatchedLabels: [],
      unrecognized: [],
    });
  });
});
