import { describe, expect, it } from 'vitest';
import {
  A4_HEIGHT_PX,
  contentBudgetPx,
  DEFAULT_STYLE,
  fontStack,
  halfPoints,
  lineTwips,
  marginPx,
  sizePx,
  twips,
} from './document-style';

describe('the units Word and the screen each want', () => {
  it('converts points to the half-points Word measures type in', () => {
    // 10.5pt was the hard-coded `size: 21` in all three exports.
    expect(halfPoints(10.5)).toBe(21);
    expect(halfPoints(12)).toBe(24);
  });

  it('converts inches to twips', () => {
    expect(twips(1)).toBe(1440);
    expect(twips(0.5)).toBe(720);
  });

  it('converts a line multiple to the 240ths Word wants', () => {
    expect(lineTwips(1)).toBe(240);
    expect(lineTwips(1.5)).toBe(360);
  });

  it('renders the default body size at the 14px the page was built at', () => {
    expect(sizePx(DEFAULT_STYLE.size)).toBe(14);
  });
});

describe('how much room one page has', () => {
  it('matches the constant the trim used before the margin could change', () => {
    // The old PAGE_CONTENT_PX, now derived rather than written down.
    expect(contentBudgetPx(1)).toBe(931);
  });

  it('buys real room when the margins narrow', () => {
    // The reason margin is on the toolbar at all: 76px is three or four
    // bullet lines, which is often the difference between one page and two.
    expect(contentBudgetPx(0.6) - contentBudgetPx(1)).toBe(76);
  });

  it('never claims more room than the sheet has', () => {
    for (const margin of [0.5, 0.6, 0.75, 1, 1.25]) {
      expect(contentBudgetPx(margin)).toBeLessThan(A4_HEIGHT_PX);
      expect(contentBudgetPx(margin)).toBe(A4_HEIGHT_PX - marginPx(margin) * 2);
    }
  });
});

describe('fontStack', () => {
  it('gives every offered face something to render with', () => {
    expect(fontStack('Georgia')).toContain('Georgia');
  });

  it('falls back rather than returning undefined for a face we dropped', () => {
    // A stored setting outlives the list it was chosen from.
    expect(fontStack('Papyrus')).toBe(fontStack('Calibri'));
  });
});
