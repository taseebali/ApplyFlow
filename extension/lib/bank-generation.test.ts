import { describe, expect, it } from 'vitest';
import {
  buildGenerationPrompt,
  needsRetry,
  parseVariants,
  sourcesFrom,
  sourcesMissingMetrics,
  type Source,
} from './bank-generation';
import { EMPTY_PROFILE } from './schema';
import { makeVariant } from './bullet-bank';

const source: Source = {
  id: 's1',
  label: 'Repo Triage Agent',
  facts: 'Built an evaluation harness scoring the agent against 10 verified fixes.',
  techStack: 'python, fastapi',
};

const wrap = (variants: unknown[]) => JSON.stringify({ variants });

describe('the quality gate', () => {
  it('keeps a well-written variant', () => {
    const { kept } = parseVariants(
      wrap([
        {
          angle: 'impact',
          text: 'Raised file-match accuracy to 90% across 10 verified fixes.',
          estimated: ['90%'],
        },
      ]),
      's1',
      'Cut triage time 40%. Built it against 10 real bug fixes. Cut cost 20%.'
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.hasMetric).toBe(true);
  });

  it('rejects the model’s own faults rather than banking them', () => {
    const { kept, rejected } = parseVariants(
      wrap([
        { angle: 'impact', text: 'Responsible for 3 evaluation harnesses.' },
        { angle: 'technical', text: 'Worked with 4 cross-functional teams on the agent.' },
      ]),
      's1',
      'Cut triage time 40%. Built it against 10 real bug fixes. Cut cost 20%.'
    );
    expect(kept).toEqual([]);
    expect(rejected).toHaveLength(2);
  });

  it('keeps a good variant that happens to have no number', () => {
    // The model cannot invent the metric; that is a question for the user, not
    // a reason to throw away a correctly written sentence.
    const { kept } = parseVariants(
      wrap([{ angle: 'ownership', text: 'Owned the triage pipeline end to end.' }]),
      's1',
      'Cut triage time 40%. Built it against 10 real bug fixes. Cut cost 20%.'
    );
    expect(kept).toHaveLength(1);
  });

  it('enforces one verb per source, however the model was asked', () => {
    // This is the original 40/100 fault. Rule 2 asks for variety; this is what
    // makes it true.
    const { kept, rejected } = parseVariants(
      wrap([
        { angle: 'technical', text: 'Built a FastAPI backend with 6 tools.' },
        { angle: 'scale', text: 'Built an evaluation harness over 10 fixes.' },
        { angle: 'impact', text: 'Cut triage time by 40%.' },
      ]),
      's1',
      'Cut triage time 40%. Built it against 10 real bug fixes. Cut cost 20%.'
    );
    expect(kept.map((v) => v.openingVerb)).toEqual(['built', 'cut']);
    expect(rejected).toHaveLength(1);
  });

  it('stamps every kept variant with the source it came from', () => {
    const { kept } = parseVariants(wrap([{ angle: 'impact', text: 'Cut triage time 40%.' }]), 'project-7', 'Cut triage time 40%. Built it against 10 real bug fixes. Cut cost 20%.');
    expect(kept[0]!.sourceId).toBe('project-7');
  });

  it('reads a domain hint, and treats the string "null" as none', () => {
    const { kept } = parseVariants(
      wrap([
        { angle: 'impact', text: 'Cut triage time 40%.', domain: 'Backend Engineer' },
        { angle: 'scale', text: 'Scaled ingest to 12k documents.', domain: 'null', estimated: ['12k'] },
      ]),
      's1',
      'Cut triage time 40%. Built it against 10 real bug fixes. Cut cost 20%.'
    );
    expect(kept[0]!.domainHint).toBe('Backend Engineer');
    expect(kept[1]!.domainHint).toBeNull();
  });
});

describe('malformed output', () => {
  it('recovers JSON from fences and prose', () => {
    const raw = 'Here you go:\n```json\n' + wrap([{ angle: 'impact', text: 'Cut cost 20%.' }]) + '\n```';
    expect(parseVariants(raw, 's1', 'Cut triage time 40%. Built it against 10 real bug fixes. Cut cost 20%.').kept).toHaveLength(1);
  });

  it('returns nothing rather than throwing', () => {
    expect(parseVariants('I cannot help with that.', 's1', 'Cut triage time 40%. Built it against 10 real bug fixes. Cut cost 20%.').kept).toEqual([]);
    expect(parseVariants('{ broken', 's1', 'Cut triage time 40%. Built it against 10 real bug fixes. Cut cost 20%.').kept).toEqual([]);
    expect(parseVariants(JSON.stringify({ variants: 'nope' }), 's1', 'Cut triage time 40%. Built it against 10 real bug fixes. Cut cost 20%.').kept).toEqual([]);
  });

  it('skips an entry with an angle it does not recognise', () => {
    expect(parseVariants(wrap([{ angle: 'vibes', text: 'Cut cost 20%.' }]), 's1', 'Cut triage time 40%. Built it against 10 real bug fixes. Cut cost 20%.').kept).toEqual([]);
  });
});

describe('needsRetry', () => {
  const good = (text: string) => makeVariant({ sourceId: 's1', angle: 'impact', text });

  it('asks for another attempt when most framings were discarded', () => {
    expect(needsRetry([good('Cut cost 20%.')])).toBe(true);
  });

  it('accepts a source that produced most of its framings', () => {
    const variants = ['Cut cost 20%.', 'Scaled to 3 regions.', 'Owned the rollout.', 'Shipped in 2 weeks.'].map(good);
    expect(needsRetry(variants)).toBe(false);
  });
});

describe('sourcesFrom', () => {
  it('flattens roles and projects into one shape', () => {
    const profile = {
      ...EMPTY_PROFILE,
      workHistory: [
        {
          id: 'w1',
          company: 'Revel8',
          title: 'Engineer',
          location: '',
          startDate: '',
          endDate: '',
          current: true,
          bullets: [{ id: 'b1', text: 'Shipped 3 services.' }],
        },
      ],
      projects: [
        {
          id: 'p1',
          name: 'ApplyFlow',
          role: 'Author',
          bullets: [{ id: 'b2', text: 'Built an autofiller.' }],
          techStack: 'TypeScript',
          outcomes: '',
          link: '',
        },
      ],
    };

    const sources = sourcesFrom(profile);
    expect(sources.map((s) => s.label)).toEqual(['Engineer at Revel8', 'ApplyFlow']);
    expect(sources[1]!.techStack).toBe('TypeScript');
  });

  it('skips anything with no facts, rather than asking the model to invent from a title', () => {
    const profile = {
      ...EMPTY_PROFILE,
      projects: [{ id: 'p1', name: 'Empty', role: '', bullets: [], techStack: '', outcomes: '' , link: ''}],
    };
    expect(sourcesFrom(profile)).toEqual([]);
  });
});

describe('sourcesMissingMetrics', () => {
  it('names the items worth asking the user about', () => {
    const withNumbers = { ...source, id: 'has' };
    const without = { ...source, id: 'none', facts: 'Built a triage pipeline for incoming issues.' };
    expect(sourcesMissingMetrics([withNumbers, without]).map((s) => s.id)).toEqual(['none']);
  });
});

describe('buildGenerationPrompt', () => {
  it('forbids inventing a fact that is not in the source', () => {
    expect(buildGenerationPrompt(source, [])).toMatch(/must be listed in the "estimated" array/i);
  });

  it('lets the model estimate a figure the source implies, and only a figure', () => {
    const prompt = buildGenerationPrompt(source, []);
    expect(prompt).toMatch(/MAY estimate a figure that SOURCE plainly implies/i);
    // Everything else still has to come from the source, and an estimate has
    // to be declared or the bullet is thrown away.
    expect(prompt).toMatch(/must already appear in SOURCE/i);
    expect(prompt).toMatch(/must be listed in the \"estimated\" array/i);
  });

  it('names the target families when they are known', () => {
    const prompt = buildGenerationPrompt(source, [{ name: 'Applied ML', angles: [] as never }]);
    expect(prompt).toContain('Applied ML');
  });

  it('says so plainly when no families are known', () => {
    expect(buildGenerationPrompt(source, [])).toMatch(/no target roles are known/i);
  });

  it('includes the source facts and technologies', () => {
    const prompt = buildGenerationPrompt(source, []);
    expect(prompt).toContain('10 verified fixes');
    expect(prompt).toContain('python, fastapi');
  });
});

describe('estimated figures', () => {
  const FACTS = 'Built a triage agent and tested it against real, verified bug fixes.';

  it('keeps a figure the model declared it estimated, and records which', () => {
    // The bank was built on "never invent a number", which is why seven items
    // on a real profile reported nothing measurable and produced flat bullets.
    // Estimating is allowed now; estimating silently is not.
    const { kept } = parseVariants(
      wrap([{ angle: 'impact', text: 'Resolved roughly 10 verified fixes.', estimated: ['10'] }]),
      's1',
      FACTS
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.estimated).toEqual(['10']);
  });

  it('throws away a figure nobody took responsibility for', () => {
    const { kept, rejected } = parseVariants(
      wrap([{ angle: 'impact', text: 'Raised accuracy to 94%.' }]),
      's1',
      FACTS
    );
    expect(kept).toEqual([]);
    expect(rejected).toHaveLength(1);
  });

  it('marks nothing on a bullet whose numbers all came from the source', () => {
    const { kept } = parseVariants(
      wrap([{ angle: 'impact', text: 'Cut triage time 40%.' }]),
      's1',
      'Cut triage time 40% on average.'
    );
    expect(kept[0]!.estimated).toBeUndefined();
  });

  it('ignores a declaration for a figure the bullet does not contain', () => {
    // It would mark the wrong thing in the panel, which is worse than marking
    // nothing.
    const { kept } = parseVariants(
      wrap([{ angle: 'ownership', text: 'Owned the pipeline end to end.', estimated: ['40%'] }]),
      's1',
      FACTS
    );
    expect(kept[0]!.estimated).toBeUndefined();
  });
});
