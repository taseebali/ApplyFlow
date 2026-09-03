import { scoreSection, type BulletFault } from '@/lib/bullet-quality';
import { textToBullets, type BulletEntry } from '@/lib/schema';

/**
 * The editor for one role's or project's achievements, with the quality faults
 * shown against the bullet that has them.
 *
 * Showing the faults here rather than in a separate report is the point: the
 * moment to learn that four bullets open with the same verb is while you are
 * looking at them, not after an ATS has scored the resume 40.
 */

const FAULT_LABEL: Record<BulletFault['kind'], string> = {
  'verb-collision': 'repeated verb',
  'no-metric': 'no number',
  'weak-opener': 'weak opener',
  cliche: 'cliché',
  'too-long': 'too long',
  passive: 'passive',
};

export function BulletsField({
  bullets,
  onChange,
}: {
  bullets: BulletEntry[];
  onChange: (bullets: BulletEntry[]) => void;
}) {
  const { perBullet, score } = scoreSection(bullets.map((b) => b.text));

  const update = (id: string, text: string) =>
    onChange(bullets.map((b) => (b.id === id ? { ...b, text } : b)));

  const add = () => onChange([...bullets, { id: crypto.randomUUID(), text: '' }]);
  const remove = (id: string) => onChange(bullets.filter((b) => b.id !== id));

  /**
   * Pasting several lines at once is how a resume actually gets in here, so a
   * multi-line paste becomes multiple bullets rather than one long one.
   */
  const handlePaste = (id: string, event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text');
    if (!/\r?\n/.test(text.trim())) return;

    event.preventDefault();
    const pasted = textToBullets(text);
    if (pasted.length === 0) return;
    onChange(bullets.flatMap((b) => (b.id === id ? pasted : [b])));
  };

  const written = bullets.filter((b) => b.text.trim().length > 0).length;

  return (
    <div className="bullets">
      <div className="bullets-head">
        <span>Achievements</span>
        {written > 0 && (
          <span className={`pill ${score >= 80 ? 'pill-success' : score >= 55 ? 'pill-warning' : 'pill-danger'}`}>
            {score}/100
          </span>
        )}
      </div>

      {bullets.length === 0 && (
        <p className="hint">
          One achievement per line. Paste several at once and they will be split up.
        </p>
      )}

      {bullets.map((bullet, index) => {
        const faults = perBullet[index] ?? [];
        return (
          <div className="bullet-row" key={bullet.id}>
            <textarea
              className="bullet-text"
              rows={2}
              value={bullet.text}
              placeholder="Cut checkout latency 40% by replacing 3 synchronous calls with a queue."
              onChange={(e) => update(bullet.id, e.target.value)}
              onPaste={(e) => handlePaste(bullet.id, e)}
            />
            <button
              type="button"
              className="btn-plain bullet-remove"
              aria-label="Remove this achievement"
              onClick={() => remove(bullet.id)}
            >
              Remove
            </button>
            {faults.length > 0 && (
              <div className="bullet-faults">
                {faults.map((fault) => (
                  <span key={fault.kind + fault.detail} className="pill pill-warning" title={fault.detail}>
                    {FAULT_LABEL[fault.kind]}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button type="button" className="btn" onClick={add}>
        + Add achievement
      </button>
    </div>
  );
}
