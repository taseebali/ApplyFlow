import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchFields } from './field-matcher';
import { detectQuestions } from './question-detector';

/**
 * Measures matching against real application forms, saved from real ATSs.
 *
 * The rest of the suite tests our functions against inputs we wrote, which
 * proves they behave as specified and says nothing about whether a Greenhouse
 * form fills. This is the only place that answers that question, and it is
 * deliberately a *measurement* rather than a pass/fail on perfection:
 *
 *  - `wrong` must be zero. Writing the wrong value into a live application is
 *    worse than leaving a field blank, so a regression here fails the build.
 *  - `matched` must not drop below the recorded baseline. Improving matching
 *    means raising the baseline in the fixture's expectations file.
 *
 * The gap between `matched` and the size of `expect` is the honest backlog.
 * See fixtures/forms/README.md for how to add a fixture.
 */

interface Expectations {
  source: string;
  ats: string;
  expect: Record<string, string>;
  mustNotMatch?: string[];
  openQuestions?: string[];
  notQuestions?: string[];
  baseline: { matched: number; wrong: number };
}

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'forms');

function loadFixtures(): Array<{ name: string; html: string; expected: Expectations }> {
  return readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.html'))
    .map((file) => {
      const name = file.replace(/\.html$/, '');
      return {
        name,
        html: readFileSync(join(FIXTURE_DIR, file), 'utf8'),
        expected: JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.expected.json`), 'utf8')) as Expectations,
      };
    });
}

/** The id of the element a match landed on, so results key by something stable. */
function idOf(element: Element): string {
  return element.getAttribute('id') ?? element.getAttribute('name') ?? '';
}

const fixtures = loadFixtures();

it('has fixtures to measure against', () => {
  expect(fixtures.length).toBeGreaterThan(0);
});

describe.each(fixtures)('$name', ({ html, expected }) => {
  function run() {
    document.body.innerHTML = html;
    const matches = matchFields(document);
    const byId = new Map<string, string>();
    for (const match of matches) {
      const id = idOf(match.element);
      // First match wins, mirroring how the filler consumes them.
      if (id && !byId.has(id)) byId.set(id, match.path);
    }
    return byId;
  }

  it('writes nothing into a field where a value would be wrong', () => {
    const byId = run();
    const wrong: string[] = [];

    for (const id of expected.mustNotMatch ?? []) {
      const got = byId.get(id);
      if (got) wrong.push(`${id} should stay unmatched but matched ${got}`);
    }

    for (const [id, want] of Object.entries(expected.expect)) {
      const got = byId.get(id);
      if (got && got !== want) wrong.push(`${id} should match ${want} but matched ${got}`);
    }

    expect(wrong).toEqual([]);
  });

  it('matches at least as many fields as the recorded baseline', () => {
    const byId = run();
    const matched = Object.entries(expected.expect).filter(([id, want]) => byId.get(id) === want);
    const missed = Object.entries(expected.expect).filter(([id, want]) => byId.get(id) !== want);

    // Named so a drop tells you which field, not just that a number moved.
    const report = `${matched.length}/${Object.keys(expected.expect).length} matched. Still missing: ${
      missed.map(([id, want]) => `${id}→${want}`).join(', ') || 'none'
    }`;

    // Printed every run, so the current accuracy is visible without anyone
    // going looking for it. This number is the point of the whole fixture.
    console.log(`[corpus] ${expected.ats}: ${report}`);

    expect(matched.length, report).toBeGreaterThanOrEqual(expected.baseline.matched);
  });

  it('sends only genuinely open-ended fields to drafting', () => {
    document.body.innerHTML = html;
    const detected = detectQuestions(document).map((q) => idOf(q.element));

    for (const id of expected.notQuestions ?? []) {
      expect(detected, `${id} is a dropdown or a known field and must not be drafted`).not.toContain(id);
    }
    for (const id of expected.openQuestions ?? []) {
      expect(detected, `${id} is an open question and should be offered for drafting`).toContain(id);
    }
  });
});
