import { getDisplayLabel, matchFields } from './field-matcher';
import { isCombobox } from './combobox';
import { inferAnswer } from './inference';
import { isOffLimits } from './field-visibility';
import type { Profile } from './schema';

export interface DetectedQuestion {
  element: HTMLTextAreaElement | HTMLInputElement;
  question: string;
}

/** Below this, a label reads like a field name ("Ref", "City") rather than a question. */
const MIN_QUESTION_LABEL_LENGTH = 15;

/**
 * A real question is a sentence. Two or three words is a field label, however
 * long the words themselves are — which matters most in German, where a single
 * compound noun can be longer than an English sentence.
 */
const MIN_QUESTION_WORDS = 4;

function countWords(label: string): number {
  return label.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Finds the open-ended, essay-style questions on a page: fields that profile
 * matching did NOT already claim, and that look like prose prompts rather
 * than short data entry fields.
 */
export function detectQuestions(root: ParentNode = document, profile?: Profile): DetectedQuestion[] {
  const claimed = new Set(matchFields(root).map((m) => m.element));
  const questions: DetectedQuestion[] = [];

  // `input[type="text"]` only matches a literal attribute, so an `<input>`
  // with no type — which defaults to text, and is common on real forms — was
  // invisible to question detection. Filtering on the DOM property catches
  // both, because it reports the default.
  const candidates = Array.from(
    root.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input')
  ).filter((element) => element instanceof HTMLTextAreaElement || element.type === 'text');

  for (const element of candidates) {
    if (claimed.has(element)) continue;

    // reCAPTCHA ships a hidden <textarea name="g-recaptcha-response">. Being a
    // textarea it counted as open-ended, and with no label its field name
    // became the question - so a model was asked to write an essay about
    // "g-recaptcha-response".
    if (isOffLimits(element)) continue;

    // A scripted dropdown is also an `input[type=text]` with a long label, so
    // without this "What is your work authorisation in Germany?" gets sent to
    // the model as an essay question. It has a fixed list of answers and
    // belongs to the fill path, not to drafting.
    if (isCombobox(element)) continue;

    const question = getDisplayLabel(element).trim();
    if (!question) continue;

    // Nor is it a question worth paying a model for if the profile already
    // settles it.
    if (profile && inferAnswer(question, profile)) continue;

    // A textarea is inherently open-ended. A single-line input has to look like
    // an actual question — long enough, and made of several words.
    //
    // Length alone was not enough: a German form's "Gehaltsvorstellung*
    // (erforderlich)" is 31 characters but two words, and sending it to a model
    // produced an invented salary figure for a real application. A compound
    // noun is a field label; a question has a sentence in it.
    const isOpenEnded =
      element instanceof HTMLTextAreaElement ||
      (question.length >= MIN_QUESTION_LABEL_LENGTH && countWords(question) >= MIN_QUESTION_WORDS);
    if (!isOpenEnded) continue;

    questions.push({ element, question });
  }

  return questions;
}
