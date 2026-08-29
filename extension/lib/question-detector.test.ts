import { beforeEach, describe, expect, it } from 'vitest';
import { detectQuestions } from './question-detector';
import { EMPTY_PROFILE } from './schema';

function setBody(html: string) {
  document.body.innerHTML = html;
}

describe('detectQuestions', () => {
  beforeEach(() => setBody(''));

  it('finds a textarea with its label as the question', () => {
    setBody(`
      <label for="q1">Why do you want to work here?</label>
      <textarea id="q1"></textarea>
    `);
    const found = detectQuestions(document);
    expect(found).toHaveLength(1);
    expect(found[0]!.question).toBe('Why do you want to work here?');
  });

  it('ignores textareas already claimed by profile field matching', () => {
    setBody(`
      <label for="addr">Address line 1</label>
      <textarea id="addr"></textarea>
    `);
    expect(detectQuestions(document)).toHaveLength(0);
  });

  it('ignores short-label text inputs that are not open-ended questions', () => {
    setBody(`
      <label for="x">Ref</label>
      <input id="x" type="text" />
    `);
    expect(detectQuestions(document)).toHaveLength(0);
  });
});

describe('excluding non-questions', () => {
  beforeEach(() => setBody(''));

  it('ignores a scripted dropdown even though it is a long-labelled text input', () => {
    // Greenhouse renders every dropdown this way; without the combobox check
    // this reaches the model as an essay question.
    setBody(`
      <div class="select__container">
        <label for="wa">What is your work authorisation in Germany?</label>
        <div class="select__control"><input id="wa" type="text" /></div>
      </div>
    `);
    expect(detectQuestions(document)).toHaveLength(0);
  });

  it('still finds a genuine free-text question', () => {
    setBody(`
      <label for="why">Why Raisin? And why this specific role?</label>
      <textarea id="why"></textarea>
    `);
    expect(detectQuestions(document)).toHaveLength(1);
  });

  it('skips a question the profile already answers', () => {
    setBody(`
      <label for="enr">Are you currently enrolled at a German university/college?</label>
      <textarea id="enr"></textarea>
    `);
    const studying = {
      ...EMPTY_PROFILE,
      education: [
        {
          id: 'e1',
          school: 'Hochschule',
          degree: 'BSc',
          fieldOfStudy: '',
          startDate: '2024',
          endDate: '2027',
          current: true,
        },
      ],
    };
    expect(detectQuestions(document)).toHaveLength(1);
    expect(detectQuestions(document, studying)).toHaveLength(0);
  });
});
