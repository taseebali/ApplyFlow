import { beforeEach, describe, expect, it } from 'vitest';
import { detectQuestions } from './question-detector';

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
