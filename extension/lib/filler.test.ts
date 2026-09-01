import { describe, expect, it } from 'vitest';
import {
  beginFillJournal,
  journalSize,
  resetFillJournal,
  setNativeFieldValue,
  undoFill,
} from './filler';

function inputWith(value: string): HTMLInputElement {
  document.body.innerHTML = `<form><label>First name<input name="first_name" value="${value}"></label></form>`;
  return document.querySelector('input')!;
}

describe('undo after more than one fill', () => {
  it('returns the form to how the user found it, not to the first fill', () => {
    // The journal used to be cleared at the start of every run, so a second
    // fill recorded the first fill's values as "previous" and undo stopped one
    // step short — the form came back to the first fill instead of to the
    // user's own data.
    const el = inputWith('Original');
    resetFillJournal();

    beginFillJournal();
    setNativeFieldValue(el, 'Jordan');
    expect(el.value).toBe('Jordan');

    beginFillJournal();
    setNativeFieldValue(el, 'Avery');
    expect(el.value).toBe('Avery');

    undoFill();
    expect(el.value).toBe('Original');
  });

  it('records a field once however many times it is written', () => {
    const el = inputWith('Original');
    resetFillJournal();

    beginFillJournal();
    setNativeFieldValue(el, 'one');
    setNativeFieldValue(el, 'two');
    setNativeFieldValue(el, 'three');

    expect(journalSize()).toBe(1);
  });

  it('forgets the page once it has actually changed', () => {
    const el = inputWith('before');
    resetFillJournal();

    beginFillJournal();
    setNativeFieldValue(el, 'written');
    expect(journalSize()).toBe(1);

    // A navigation or step change: those elements are gone, and what they held
    // describes a form that no longer exists.
    resetFillJournal();
    expect(journalSize()).toBe(0);
    expect(undoFill()).toBe(0);
  });

  it('is empty again after undoing, so a second undo does nothing', () => {
    const el = inputWith('Original');
    resetFillJournal();

    beginFillJournal();
    setNativeFieldValue(el, 'Jordan');

    expect(undoFill()).toBe(1);
    expect(undoFill()).toBe(0);
    expect(el.value).toBe('Original');
  });
});
