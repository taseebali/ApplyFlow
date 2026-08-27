import { beforeEach, describe, expect, it } from 'vitest';
import { fieldSignature, findUnrecognizedFields, matchFields } from './field-matcher';

function setBody(html: string) {
  document.body.innerHTML = html;
}

describe('fieldSignature', () => {
  beforeEach(() => setBody(''));

  it('prefers name, then id, then label', () => {
    setBody('<input name="n" id="i" />');
    expect(fieldSignature(document.querySelector('input')!)).toBe('name:n');
    setBody('<input id="i" />');
    expect(fieldSignature(document.querySelector('input')!)).toBe('id:i');
    setBody('<label for="x">Custom Question</label><input id="x" name="" />');
    expect(fieldSignature(document.querySelector('input')!)).toBe('id:x');
  });

  it('is stable across re-renders of the same markup', () => {
    setBody('<input name="custom_attribute_4447624" />');
    const first = fieldSignature(document.querySelector('input')!);
    setBody('<div><span></span><input name="custom_attribute_4447624" /></div>');
    expect(fieldSignature(document.querySelector('input')!)).toBe(first);
  });
});

describe('matchFields with overrides', () => {
  beforeEach(() => setBody(''));

  it('uses a taught mapping for a field heuristics cannot place', () => {
    setBody('<label for="q">Kontaktnummer</label><input id="q" name="custom_9" />');
    expect(matchFields(document)).toHaveLength(0);

    const matches = matchFields(document, { 'name:custom_9': 'contact.phone' });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.path).toBe('contact.phone');
    expect(matches[0]!.confidence).toBe(1);
  });

  it('lets a taught mapping win over the heuristic guess', () => {
    setBody('<label for="e">Email</label><input id="e" name="email" />');
    expect(matchFields(document)[0]!.path).toBe('contact.email');
    expect(matchFields(document, { 'name:email': 'links.website' })[0]!.path).toBe('links.website');
  });
});

describe('findUnrecognizedFields', () => {
  beforeEach(() => setBody(''));

  it('reports only the fields matching could not identify', () => {
    setBody(`
      <label for="e">Email</label><input id="e" name="email" />
      <label for="q">Kontaktnummer</label><input id="q" name="custom_9" />
    `);
    const unknown = findUnrecognizedFields(document);
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.label).toBe('Kontaktnummer');
    expect(unknown[0]!.signature).toBe('name:custom_9');
  });

  it('stops reporting a field once it has been taught', () => {
    setBody('<label for="q">Kontaktnummer</label><input id="q" name="custom_9" />');
    expect(findUnrecognizedFields(document, { 'name:custom_9': 'contact.phone' })).toHaveLength(0);
  });

  it('does not list the same field twice', () => {
    setBody('<input name="dup" /><input name="dup" />');
    expect(findUnrecognizedFields(document)).toHaveLength(1);
  });
});
