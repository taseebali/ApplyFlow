import { useState } from 'react';
import type { SetupStep } from './SetupView';

export function Wizard({ steps, onDone }: { steps: SetupStep[]; onDone: () => void }) {
  const [index, setIndex] = useState(0);
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
        <h2 className="wizard-title">{step.title}</h2>
        <p className="wizard-blurb">{step.blurb}</p>
        {step.render()}
      </div>

      <div className="wizard-nav">
        {index > 0 && (
          <button type="button" className="btn" onClick={() => setIndex(index - 1)}>
            Back
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => (isLast ? onDone() : setIndex(index + 1))}
        >
          {isLast ? 'Finish' : 'Next'}
        </button>
      </div>
    </div>
  );
}
