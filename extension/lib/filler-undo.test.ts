import { beforeEach, describe, expect, it } from 'vitest';
import { beginFillJournal, journalSize, setNativeFieldValue, undoFill } from './filler';

function field(value = ''): HTMLInputElement {
  const el = document.createElement('input');
  el.value = value;
  document.body.append(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  beginFillJournal();
});

describe('undoing a fill', () => {
  it('puts a field back to what it held before', () => {
    const el = field('typed by hand');
    setNativeFieldValue(el, 'written by us');
    expect(el.value).toBe('written by us');

    expect(undoFill()).toBe(1);
    expect(el.value).toBe('typed by hand');
  });

  it('restores an empty field to empty, not to the filled value', () => {
    const el = field('');
    setNativeFieldValue(el, 'x');
    undoFill();
    expect(el.value).toBe('');
  });

  it('remembers the value from before the fill, not the previous write', () => {
    // A field written twice in one run must still return to the user's value.
    const el = field('original');
    setNativeFieldValue(el, 'first');
    setNativeFieldValue(el, 'second');
    undoFill();
    expect(el.value).toBe('original');
  });

  it('restores every field of a multi-field fill', () => {
    const a = field('a0');
    const b = field('b0');
    setNativeFieldValue(a, 'a1');
    setNativeFieldValue(b, 'b1');

    expect(undoFill()).toBe(2);
    expect([a.value, b.value]).toEqual(['a0', 'b0']);
  });

  it('skips a field that has been removed from the page', () => {
    const staying = field('keep');
    const going = field('gone');
    setNativeFieldValue(staying, 'x');
    setNativeFieldValue(going, 'y');
    going.remove();

    expect(undoFill()).toBe(1);
    expect(staying.value).toBe('keep');
  });

  it('starts empty for each fill, so an old run cannot be undone twice', () => {
    const el = field('one');
    setNativeFieldValue(el, 'two');
    undoFill();

    expect(journalSize()).toBe(0);
    expect(undoFill()).toBe(0);
    expect(el.value).toBe('one');
  });

  it('counts what can be undone while a fill is in progress', () => {
    setNativeFieldValue(field(), 'x');
    setNativeFieldValue(field(), 'y');
    expect(journalSize()).toBe(2);
  });
});
