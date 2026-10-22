// Small hand-drawn 2D SVG illustrations. Each one is a plain function, so a new
// product type is just one more case. The product name picks which one to show.
type Kind = "drink" | "chocolate" | "chips" | "cookie" | "peanuts";

export function kindOf(name: string): Kind {
  const n = name.toLowerCase();
  // \b = whole words only, so "chocolate" is not mistaken for "cola".
  if (/\b(coffee|tea|cola|soda|juice|drink)\b/.test(n)) return "drink";
  if (/\b(choc\w*|candy|wafers?)\b/.test(n)) return "chocolate";
  if (/\b(biscuits?|cookies?|bakery)\b/.test(n)) return "cookie";
  if (/\b(peanuts?|nuts?|almonds?|cashews?)\b/.test(n)) return "peanuts";
  return "chips"; // chips, nachos and anything else
}

export function ProductIcon({ name }: { name: string }) {
  const kind = kindOf(name);
  return (
    <svg className="product-icon" viewBox="0 0 100 100" role="img" aria-label={`${name} illustration`}>
      {kind === "drink" && (
        <>
          <rect x="30" y="30" width="40" height="56" rx="8" fill="#6f4e37" />
          <rect x="30" y="46" width="40" height="22" fill="#fff4e0" />
          <rect x="26" y="22" width="48" height="12" rx="6" fill="#e8d5b7" />
          <rect x="50" y="6" width="5" height="22" rx="2" fill="#e5484d" transform="rotate(12 52 17)" />
          <circle cx="50" cy="57" r="5" fill="#6f4e37" />
        </>
      )}
      {kind === "chocolate" && (
        <>
          <rect x="18" y="26" width="64" height="50" rx="8" fill="#5b3a29" />
          <path d="M18 34h64M18 51h64M18 67h64M39 26v50M60 26v50" stroke="#3e2619" strokeWidth="3" />
          <rect x="18" y="58" width="64" height="18" rx="6" fill="#e5484d" />
          <text x="50" y="72" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#fff">
            CHOCO
          </text>
        </>
      )}
      {kind === "chips" && (
        <>
          <path d="M24 24 Q50 14 76 24 L70 84 Q50 92 30 84 Z" fill="#f5a623" />
          <path d="M24 24 Q50 34 76 24" stroke="#d98a0b" strokeWidth="4" fill="none" />
          <circle cx="50" cy="55" r="16" fill="#fff4cf" />
          <path d="M42 56 Q50 44 58 56 Q50 66 42 56Z" fill="#f5a623" />
        </>
      )}
      {kind === "peanuts" && (
        <>
          <path d="M18 56h64q-2 28-32 28T18 56z" fill="#8d5a3b" />
          <rect x="14" y="52" width="72" height="9" rx="4.5" fill="#a86f4a" />
          <g fill="#e6b873" stroke="#b98544" strokeWidth="2">
            <g transform="rotate(-25 36 42)"><ellipse cx="30" cy="42" rx="9" ry="7" /><ellipse cx="43" cy="42" rx="9" ry="7" /></g>
            <g transform="rotate(20 62 38)"><ellipse cx="56" cy="38" rx="9" ry="7" /><ellipse cx="69" cy="38" rx="9" ry="7" /></g>
            <g transform="rotate(-5 50 26)"><ellipse cx="44" cy="26" rx="9" ry="7" /><ellipse cx="57" cy="26" rx="9" ry="7" /></g>
          </g>
        </>
      )}
      {kind === "cookie" && (
        <>
          <circle cx="50" cy="52" r="34" fill="#d9a066" />
          <circle cx="50" cy="52" r="34" fill="none" stroke="#b97d3e" strokeWidth="4" />
          <circle cx="38" cy="42" r="5" fill="#5b3a29" />
          <circle cx="60" cy="40" r="4" fill="#5b3a29" />
          <circle cx="56" cy="62" r="5" fill="#5b3a29" />
          <circle cx="36" cy="62" r="4" fill="#5b3a29" />
        </>
      )}
    </svg>
  );
}
