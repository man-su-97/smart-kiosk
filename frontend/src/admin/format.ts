// Turns what an admin types ("45", "45.5", "45.50") into whole paise without floating-point
// maths: the rupee and paise parts are read as separate whole numbers. Returns null if invalid.
export function rupeesToPaise(text: string): number | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
}

export const paiseToRupeesText = (paise: number) => (paise / 100).toFixed(2);

// Today's date in India as YYYY-MM-DD (reports are grouped by India days).
export function todayInIndia(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}
