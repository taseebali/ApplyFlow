import { beforeEach, describe, expect, it } from 'vitest';
import { fieldSignature, findUnrecognizedFields, matchFields, normalizeText } from './field-matcher';

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

describe('alias specificity', () => {
  beforeEach(() => setBody(''));

  const pathFor = (label: string, id = 'f') => {
    setBody(`<label for="${id}">${label}</label><input id="${id}" />`);
    return matchFields(document)[0]?.path;
  };

  it('prefers the more specific field over a generic one', () => {
    // "Preferred First Name" contains both "name" and "first name"; the
    // longer, more specific alias has to win.
    expect(pathFor('Preferred First Name')).toBe('contact.firstName');
    expect(pathFor('Legal Last Name')).toBe('contact.lastName');
  });

  it('still matches a plain full-name field', () => {
    expect(pathFor('Full Name')).toBe('contact.fullName');
  });

  it('keeps matching ordinary labels', () => {
    expect(pathFor('Email')).toBe('contact.email');
    expect(pathFor('Phone Number')).toBe('contact.phone');
    expect(pathFor('City')).toBe('contact.city');
  });
});

describe('yes/no questions', () => {
  beforeEach(() => setBody(''));

  it('does not fill a yes/no question with a name from the profile', () => {
    // Contains "university", which is a school-name alias — but the question
    // wants yes or no, not the name of a school.
    setBody('<label for="q">Are you currently enrolled at a German university/college?</label><input id="q" />');
    const matched = matchFields(document);
    expect(matched.map((m) => m.path)).not.toContain('education.school');
  });

  it('still lets a yes/no question match a yes/no field', () => {
    setBody('<label for="q">Are you legally authorized to work in this country?</label><input id="q" />');
    expect(matchFields(document)[0]?.path).toBe('workAuthorization.authorizedToWorkInCountry');
  });

  it('leaves ordinary value fields alone', () => {
    setBody('<label for="q">University</label><input id="q" />');
    expect(matchFields(document)[0]?.path).toBe('education.school');
  });
});

describe('non-English labels', () => {
  it('folds umlauts so a German label survives normalisation', () => {
    // Before accents were folded, this normalised to "verf gbar ab" and no
    // alias could ever match it.
    expect(normalizeText('Verfügbar ab')).toBe('verfugbar ab');
    expect(normalizeText('Straße und Hausnummer')).toBe('strasse und hausnummer');
    expect(normalizeText('Universität')).toBe('universitat');
  });

  it('folds accents from other languages too', () => {
    expect(normalizeText('Prénom')).toBe('prenom');
    expect(normalizeText('Dirección')).toBe('direccion');
  });

  it('matches the core fields on a German form', () => {
    document.body.innerHTML = `
      <form>
        <label>Vorname<input name="a"></label>
        <label>Nachname<input name="b"></label>
        <label>E-Mail-Adresse<input name="c"></label>
        <label>Telefonnummer<input name="d"></label>
        <label>Wohnort<input name="e"></label>
        <label>Land<input name="f"></label>
        <label>Verfügbar ab<input name="g"></label>
      </form>`;

    const byName = new Map(matchFields(document).map((m) => [m.element.getAttribute('name'), m.path]));
    expect(byName.get('a')).toBe('contact.firstName');
    expect(byName.get('b')).toBe('contact.lastName');
    expect(byName.get('c')).toBe('contact.email');
    expect(byName.get('d')).toBe('contact.phone');
    expect(byName.get('e')).toBe('contact.city');
    expect(byName.get('f')).toBe('contact.country');
    expect(byName.get('g')).toBe('logistics.availableFrom');
  });

  it('matches German work-authorisation and education wording', () => {
    document.body.innerHTML = `
      <form>
        <label>Arbeitserlaubnis<input name="a"></label>
        <label>Studiengang<input name="b"></label>
        <label>Hochschule<input name="c"></label>
        <label>Postleitzahl<input name="d"></label>
      </form>`;

    const byName = new Map(matchFields(document).map((m) => [m.element.getAttribute('name'), m.path]));
    expect(byName.get('a')).toBe('workAuthorization.authorizedToWorkInCountry');
    expect(byName.get('b')).toBe('education.fieldOfStudy');
    expect(byName.get('c')).toBe('education.school');
    expect(byName.get('d')).toBe('contact.postalCode');
  });
});

describe('short aliases do not match inside words', () => {
  it('does not claim a long question because it contains a short alias', () => {
    // "important" contains the German city alias "ort". This claimed the field
    // and kept it out of AI drafting, which the fixture corpus caught.
    document.body.innerHTML =
      '<form><label>Please let us know if there are any important adjustments we should make<input name="q"></label></form>';
    expect(matchFields(document)).toEqual([]);
  });

  it('still matches a short alias standing as its own word', () => {
    document.body.innerHTML = '<form><label>Ort<input name="a"></label></form>';
    expect(matchFields(document)[0]?.path).toBe('contact.city');
  });

  it('keeps multi-word aliases matching inside a longer label', () => {
    document.body.innerHTML = '<form><label>Legal First Name<input name="a"></label></form>';
    expect(matchFields(document)[0]?.path).toBe('contact.firstName');
  });
});
