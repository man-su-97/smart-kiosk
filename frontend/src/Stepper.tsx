// "1 Choose → 2 Pay → 3 Collect": tells the customer where they are.
const STEPS = ["Choose", "Pay", "Collect"];

export function Stepper({ step, center = false }: { step: 1 | 2 | 3; center?: boolean }) {
  return (
    <ol className={`mb-[18px] flex gap-2 ${center ? "justify-center" : ""}`} aria-label="Progress">
      {STEPS.map((label, i) => {
        const done = i + 1 < step;
        const current = i + 1 === step;
        return (
          <li
            key={label}
            className={`flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-sm font-semibold ${
              done ? "bg-[#dcf5e8] text-[#167a4a]" : current ? "bg-ink text-white" : "bg-[#e9ebf6] text-muted"
            }`}
          >
            <span
              className={`grid size-6 place-items-center rounded-full text-xs ${
                done ? "bg-ok text-white" : current ? "bg-brand text-white" : "bg-white"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
