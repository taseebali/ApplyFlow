import { describe, expect, it } from 'vitest';
import { danglingEstimates, numbersIn, undeclaredNumbers } from './estimates';

describe('numbersIn', () => {
  it('reads the figures a resume actually writes', () => {
    expect(numbersIn('Cut latency 40% and held 8-9 FPS in 0.7 GB')).toEqual(['40%', '8', '9fps', '0.7gb']);
  });

  it('ignores a year, which is not a claimed metric', () => {
    // Otherwise every bullet that says when something happened looks like a
    // bullet making a numeric claim.
    expect(numbersIn('Shipped it in 2024')).toEqual([]);
  });

  it('reads scaled shorthand', () => {
    expect(numbersIn('Served 12k requests at 3x throughput')).toEqual(['12k', '3x']);
  });
});

describe('undeclaredNumbers', () => {
  const source = 'Built a triage agent tested against real verified bug fixes.';

  it('passes a figure the source already states', () => {
    expect(undeclaredNumbers('Cut triage time 40%', 'Cut triage time 40% on average', [])).toEqual([]);
  });

  it('passes a figure the model declared as an estimate', () => {
    expect(undeclaredNumbers('Resolved roughly 10 bug fixes', source, ['10 bug fixes'])).toEqual([]);
  });

  it('catches a figure that is neither', () => {
    // This is the case the whole feature has to keep impossible: a number on a
    // resume that nobody, user or model, has taken responsibility for.
    expect(undeclaredNumbers('Cut triage time 90%', source, [])).toEqual(['90%']);
  });

  it('matches across formatting differences', () => {
    expect(undeclaredNumbers('Held 8-9 FPS', 'ran at 8-9 fps', [])).toEqual([]);
  });
});

describe('danglingEstimates', () => {
  it('notices a declaration that is not in the bullet', () => {
    // A model that declares an estimate it did not use has misunderstood the
    // instruction, and the declaration would mark the wrong thing in the panel.
    expect(danglingEstimates('Shipped the agent', ['40%'])).toEqual(['40%']);
  });

  it('is quiet when the declaration is used', () => {
    expect(danglingEstimates('Cut time by 40%', ['40%'])).toEqual([]);
  });
});
