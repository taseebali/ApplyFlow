import { describe, expect, it } from 'vitest';
import { buildSummaryPrompt, canWriteSummary, cleanSummary, SummaryRefused } from './summary';
import { EMPTY_PROFILE, type Profile } from './schema';

const profile: Profile = {
  ...EMPTY_PROFILE,
  headline: 'AI Engineer',
  skills: ['Python', 'FastAPI'],
  projects: [
    {
      id: 'p1',
      name: 'Repo Triage Agent',
      role: '',
      bullets: [{ id: 'b1', text: 'Built an autonomous triage agent on the Anthropic API.' }],
      techStack: 'Python, FastAPI',
      outcomes: '',
      link: '',
    },
  ],
};

describe('buildSummaryPrompt', () => {
  it('writes from the profile and fences it', () => {
    const prompt = buildSummaryPrompt(profile);
    expect(prompt).toContain('Repo Triage Agent');
    expect(prompt).toContain('<<<PROFILE>>>');
  });

  it('forbids inventing anything the profile does not state', () => {
    // Same rule as the bank: a summary is the first thing an interviewer reads
    // back to you.
    expect(buildSummaryPrompt(profile)).toMatch(/Never introduce a technology, employer, number/i);
  });

  it('bans the phrases that make a summary worthless', () => {
    expect(buildSummaryPrompt(profile)).toMatch(/passionate about/i);
  });

  it('leaves out a section the profile has nothing for', () => {
    expect(buildSummaryPrompt(profile)).not.toContain('Experience:');
  });
});

describe('canWriteSummary', () => {
  it('needs something written down to write from', () => {
    expect(canWriteSummary(EMPTY_PROFILE)).toBe(false);
    expect(canWriteSummary(profile)).toBe(true);
  });
});

describe('cleanSummary', () => {
  it('strips the preamble a model wraps a one-line answer in', () => {
    expect(cleanSummary('Here is the summary: "Builds agents."')).toBe('Builds agents.');
  });

  it('strips smart quotes as well as straight ones', () => {
    expect(cleanSummary('“Builds agents.”')).toBe('Builds agents.');
  });

  it('collapses the line breaks a model adds', () => {
    expect(cleanSummary('Builds agents.\n\nShips them.')).toBe('Builds agents. Ships them.');
  });

  it('leaves a clean answer alone', () => {
    expect(cleanSummary('Builds retrieval systems.')).toBe('Builds retrieval systems.');
  });
});

describe('cleanSummary refusing a non-summary', () => {
  // Verbatim shape of what a free model actually returned when asked for one
  // line, and what then went into the profile and onto a resume.
  const REASONING =
    '1. **Analyze the Request:** - User wants a summary line for the top of a resume. - Rules: - Two sentences, max 45 words total.';

  it('refuses the model’s own working rather than saving it', () => {
    expect(() => cleanSummary(REASONING)).toThrow(SummaryRefused);
  });

  it('names what went wrong and what to do about it', () => {
    // "Could not write a summary" sends someone checking their key. This is a
    // small-model behaviour and the message should say so.
    expect(() => cleanSummary(REASONING)).toThrow(/free models often do this|different model/i);
  });

  it('refuses an essay', () => {
    expect(() => cleanSummary('word '.repeat(200))).toThrow(SummaryRefused);
  });

  it('refuses an empty answer', () => {
    expect(() => cleanSummary('   ')).toThrow(SummaryRefused);
  });

  it('still accepts a real summary', () => {
    const good = 'Builds and operates retrieval systems end to end. Comfortable from API design through deployment.';
    expect(cleanSummary(good)).toBe(good);
  });

  it('does not mistake a hyphen or a number for reasoning', () => {
    const good = 'Full-stack engineer with 3 years across Python and TypeScript. Ships and measures.';
    expect(cleanSummary(good)).toBe(good);
  });
});
