// "1 Choose → 2 Pay → 3 Collect": tells the customer where they are.
const STEPS = ["Choose", "Pay", "Collect"];

export function Stepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li key={label} className={i + 1 < step ? "done" : i + 1 === step ? "current" : ""}>
          <span className="step-dot">{i + 1 < step ? "✓" : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
