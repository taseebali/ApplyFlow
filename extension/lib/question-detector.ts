import { getDisplayLabel, matchFields } from './field-matcher';

export interface DetectedQuestion {
  element: HTMLTextAreaElement | HTMLInputElement;
  question: string;
}

/** Below this, a label reads like a field name ("Ref", "City") rather than a question. */
const MIN_QUESTION_LABEL_LENGTH = 15;

/**
 * Finds the open-ended, essay-style questions on a page: fields that profile
 * matching did NOT already claim, and that look like prose prompts rather
 * than short data entry fields.
 */
export function detectQuestions(root: ParentNode = document): DetectedQuestion[] {
  const claimed = new Set(matchFields(root).map((m) => m.element));
  const questions: DetectedQuestion[] = [];

  const candidates = Array.from(
    root.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input[type="text"]')
  );

  for (const element of candidates) {
    if (claimed.has(element)) continue;

    const question = getDisplayLabel(element).trim();
    if (!question) continue;

    // A textarea is inherently open-ended; a text input only counts when its
    // label is long enough to read as an actual question.
    const isOpenEnded =
      element instanceof HTMLTextAreaElement || question.length >= MIN_QUESTION_LABEL_LENGTH;
    if (!isOpenEnded) continue;

    questions.push({ element, question });
  }

  return questions;
}
