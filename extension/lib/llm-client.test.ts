import { describe, expect, it } from 'vitest';
import { buildPrompt } from './llm-client';
import { EMPTY_PROFILE } from './schema';

describe('buildPrompt', () => {
  it('includes the question, the job description, and project details', () => {
    const prompt = buildPrompt({
      question: 'Why do you want to work here?',
      jobDescription: 'We build security training.',
      profile: {
        ...EMPTY_PROFILE,
        projects: [
          {
            id: 'a',
            name: 'ApplyFlow',
            role: 'Author',
            description: 'A job application autofiller',
            techStack: 'TypeScript',
            outcomes: 'Cut application time',
          },
        ],
      },
    });

    expect(prompt).toContain('Why do you want to work here?');
    expect(prompt).toContain('We build security training.');
    expect(prompt).toContain('ApplyFlow');
    expect(prompt).toContain('TypeScript');
  });

  it('still produces a prompt when no job description was found', () => {
    const prompt = buildPrompt({
      question: 'Tell us about yourself.',
      jobDescription: null,
      profile: EMPTY_PROFILE,
    });
    expect(prompt).toContain('Tell us about yourself.');
  });
});
