import { describe, expect, it } from 'vitest';
import { analyseGap } from './keyword-gap';

const JD = `
We are looking for a Backend Engineer to join our platform team.
You will work with Kubernetes and Terraform to run our services.
Strong Kubernetes experience is required. Terraform knowledge is a plus.
You should be comfortable with Python and PostgreSQL.
`;

const PROFILE = 'Built Python services backed by PostgreSQL. Shipped 3 APIs with FastAPI.';

describe('analyseGap', () => {
  it('names what the posting wants and the profile never mentions', () => {
    const { missing } = analyseGap({ jobDescription: JD, profileText: PROFILE });
    expect(missing.map((m) => m.term)).toContain('kubernetes');
    expect(missing.map((m) => m.term)).toContain('terraform');
  });

  it('does not report something the profile already covers', () => {
    const { missing, covered } = analyseGap({ jobDescription: JD, profileText: PROFILE });
    expect(missing.map((m) => m.term)).not.toContain('python');
    expect(covered.map((c) => c.term)).toContain('python');
  });

  it('ranks by how often the posting repeats it', () => {
    // Repetition is the only importance signal available without a model, and
    // postings repeat what they actually care about.
    const { missing } = analyseGap({ jobDescription: JD, profileText: PROFILE });
    expect(missing[0]!.term).toBe('kubernetes');
    expect(missing[0]!.mentions).toBeGreaterThan(1);
  });

  it('ignores the boilerplate every posting is full of', () => {
    const terms = analyseGap({ jobDescription: JD, profileText: PROFILE }).missing.map((m) => m.term);
    for (const noise of ['team', 'experience', 'knowledge', 'work', 'you']) {
      expect(terms).not.toContain(noise);
    }
  });

  it('caps the list rather than returning a wall of words', () => {
    const wordy = Array.from({ length: 60 }, (_, i) => `technology${i} technology${i}`).join(' ');
    expect(analyseGap({ jobDescription: wordy, profileText: '', limit: 5 }).missing).toHaveLength(5);
  });

  it('returns nothing for an empty posting rather than throwing', () => {
    expect(analyseGap({ jobDescription: '', profileText: PROFILE })).toEqual({ missing: [], covered: [] });
  });

  it('reports everything as missing when the profile is empty', () => {
    const { missing, covered } = analyseGap({ jobDescription: JD, profileText: '' });
    expect(missing.length).toBeGreaterThan(0);
    expect(covered).toEqual([]);
  });

  it('is case-insensitive on both sides', () => {
    const { covered } = analyseGap({ jobDescription: 'We use KUBERNETES daily. Kubernetes.', profileText: 'kubernetes' });
    expect(covered.map((c) => c.term)).toContain('kubernetes');
  });
});
