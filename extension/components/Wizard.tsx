import { useEffect, useRef, useState } from 'react';
import type { SetupStep } from './SetupView';

export function Wizard({
  steps,
  onDone,
  onAdvance,
}: {
  steps: SetupStep[];
  onDone: () => void;
  /** Called on every step change, so an abandoned setup keeps what was entered. */
  onAdvance?: () => Promise<void> | void;
}) {
  const [index, setIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Next used to swap the whole body with nothing announced and focus left on
  // a button that had moved.
  useEffect(() => {
    headingRef.current?.focus();
  }, [index]);

  const go = (next: number) => {
    void Promise.resolve(onAdvance?.()).then(() => setIndex(next));
  };

  const step = steps[index];
  if (!step) return null;

  const isLast = index === steps.length - 1;

  return (
    <div className="wizard">
      <div className="wizard-progress" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={steps.length}>
        {steps.map((s, i) => (
          <span key={s.id} className={`wizard-dot ${i <= index ? 'wizard-dot-active' : ''}`} />
        ))}
      </div>

      <div className="wizard-step" key={step.id}>
        <h2 className="wizard-title" ref={headingRef} tabIndex={-1}>
          {step.title}
          {step.optional && <span className="pill pill-neutral ml-2">Optional</span>}
        </h2>
        <p className="wizard-blurb">{step.blurb}</p>
        {step.render()}
      </div>

      <p className="hint wizard-count">
        Step {index + 1} of {steps.length} · saved as you go
      </p>

      <div className="actions mt-4">
        {index > 0 && (
          <button type="button" className="btn" onClick={() => go(index - 1)}>
            Back
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => (isLast ? onDone() : go(index + 1))}>
          {isLast ? 'Finish' : step.optional ? 'Skip' : 'Next'}
        </button>
      </div>
    </div>
  );
}
