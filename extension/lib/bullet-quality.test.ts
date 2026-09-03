import { describe, expect, it } from 'vitest';
import { hasMetric, isPublishable, openingVerb, scoreBullet, scoreSection } from './bullet-quality';

const kinds = (text: string) => scoreBullet(text).map((f) => f.kind);

describe('the faults that produced a 40/100', () => {
  // The exact shape of the resume that scored badly: same verb over and over,
  // no numbers anywhere.
  const REPETITIVE = [
    'Built a RAG system over PDFs and video transcripts.',
    'Built an evaluation harness for the agent.',
    'Built a FastAPI backend with tool calling.',
    'Built a Docker image for reproducible setup.',
    'Built an AutoML platform deployed on Hugging Face Spaces.',
    'Designed a triage workflow for incoming issues.',
    'Shipped a CLI for local runs.',
  ];

  it('finds one collision for every repeat after the first', () => {
    const { all } = scoreSection(REPETITIVE);
    const collisions = all.filter((f) => f.kind === 'verb-collision');
    // Five "Built" bullets: the second through fifth are collisions.
    expect(collisions).toHaveLength(4);
  });

  it('scores a repetitive, number-free section badly', () => {
    expect(scoreSection(REPETITIVE).score).toBeLessThan(40);
  });

  it('scores the same facts well once they vary and carry numbers', () => {
    const better = [
      'Built a RAG system over 500 PDFs and video transcripts, cutting lookup from minutes to seconds.',
      'Evaluated the agent against 10 verified bug fixes, reaching 90% file-match accuracy.',
      'Containerised the stack with Docker, dropping setup from 2 hours to 10 minutes.',
      'Shipped an AutoML platform to Hugging Face Spaces, serving 40 monthly users.',
    ];
    expect(scoreSection(better).score).toBeGreaterThan(85);
  });
});

describe('scoreBullet', () => {
  it('flags a bullet with no number in it', () => {
    expect(kinds('Improved pipeline reliability.')).toContain('no-metric');
  });

  it('accepts any digit as a metric', () => {
    expect(hasMetric('Cut p99 latency by 40%')).toBe(true);
    expect(hasMetric('Reduced latency significantly')).toBe(false);
  });

  it('flags openers that describe involvement rather than achievement', () => {
    expect(kinds('Responsible for 3 microservices.')).toContain('weak-opener');
    expect(kinds('Worked on 2 data pipelines.')).toContain('weak-opener');
    expect(kinds('Leveraged 4 internal APIs.')).toContain('weak-opener');
  });

  it('does not flag a strong opener', () => {
    expect(kinds('Rebuilt 3 microservices around a shared queue.')).not.toContain('weak-opener');
  });

  it('flags resume cliches', () => {
    expect(kinds('Collaborated with 4 cross-functional teams.')).toContain('cliche');
    expect(kinds('Thrived in a fast-paced environment for 2 years.')).toContain('cliche');
  });

  it('reports a cliche once, however many appear', () => {
    const faults = scoreBullet('A detail-oriented team player in a fast-paced setting for 2 years.');
    expect(faults.filter((f) => f.kind === 'cliche')).toHaveLength(1);
  });

  it('flags a bullet too long to skim', () => {
    expect(kinds(`Delivered 1 thing ${'and another thing '.repeat(15)}`)).toContain('too-long');
  });

  it('flags passive construction', () => {
    expect(kinds('The service was migrated to 3 new regions.')).toContain('passive');
  });

  it('finds nothing wrong with a good bullet', () => {
    expect(kinds('Cut checkout latency 40% by replacing 3 synchronous calls with a queue.')).toEqual([]);
  });

  it('returns nothing for an empty bullet rather than a pile of faults', () => {
    expect(scoreBullet('   ')).toEqual([]);
  });
});

describe('openingVerb', () => {
  it('takes the first word, lowercased', () => {
    expect(openingVerb('Built a thing')).toBe('built');
  });

  it('ignores bullet characters and punctuation', () => {
    expect(openingVerb('• Shipped, eventually')).toBe('shipped');
    expect(openingVerb('- Designed the API')).toBe('designed');
  });

  it('is empty for an empty bullet, so it never collides', () => {
    expect(openingVerb('')).toBe('');
  });

  it('does not treat two blank bullets as a collision', () => {
    const { all } = scoreSection(['', '  ']);
    expect(all.filter((f) => f.kind === 'verb-collision')).toEqual([]);
  });
});

describe('scoreSection', () => {
  it('keeps faults aligned with the bullet they belong to', () => {
    const { perBullet } = scoreSection(['Cut costs 20%.', 'Cut latency 30%.']);
    expect(perBullet[0]!.map((f) => f.kind)).not.toContain('verb-collision');
    expect(perBullet[1]!.map((f) => f.kind)).toContain('verb-collision');
  });

  it('never scores below zero, however bad the section', () => {
    const awful = Array.from({ length: 12 }, () => 'Responsible for cross-functional fast-paced team player work');
    expect(scoreSection(awful).score).toBe(0);
  });

  it('scores an empty section as perfect rather than dividing by nothing', () => {
    expect(scoreSection([]).score).toBe(100);
  });
});

describe('isPublishable', () => {
  it('lets a well-written bullet into the bank', () => {
    expect(isPublishable('Cut build times 60% by caching 4 dependency layers.')).toBe(true);
  });

  it('lets a good bullet through even with no number', () => {
    // The model cannot invent the metric — that is a question for the user,
    // not a reason to throw away a correctly written sentence.
    expect(isPublishable('Rebuilt the ingest path around an append-only log.')).toBe(true);
  });

  it('keeps the model’s own faults out', () => {
    expect(isPublishable('Responsible for 3 services.')).toBe(false);
    expect(isPublishable('Worked with 5 cross-functional teams.')).toBe(false);
  });
});
