import { useEffect, useState } from "react";
import { formatRupees } from "../api";
import { dailyPdfUrl, fetchSummary, type Summary } from "./adminApi";
import { todayInIndia } from "./format";

// Pick a day, see its totals, download the PDF. The PDF is a plain link: the browser
// sends the session cookie with it, so no extra download code is needed.
export function Reports() {
  const [date, setDate] = useState(todayInIndia());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    fetchSummary({ from: date, to: date })
      .then(setSummary)
      .catch((e) => setError(e.message));
  }, [date]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-3xl font-extrabold tracking-tight">Daily report</h1>
      <div className="card flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Day (India time)
          <input
            type="date"
            value={date}
            max={todayInIndia()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-xl border-2 border-line p-2.5"
          />
        </label>
        <a className="btn btn-primary px-6 py-3 text-base" href={dailyPdfUrl(date)} download>
          Download PDF
        </a>
      </div>
      {error && <p className="font-bold text-bad">{error}</p>}
      {summary && (
        <div className="card grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="report-summary">
          <Stat label="Revenue" value={formatRupees(summary.revenuePaise)} />
          <Stat label="Cost" value={formatRupees(summary.costPaise)} />
          <Stat label="Profit" value={formatRupees(summary.profitPaise)} />
          <Stat label="Orders" value={String(summary.orders)} />
          <Stat label="Units" value={String(summary.units)} />
          <Stat label="Cash collected" value={formatRupees(summary.cashCollectedPaise)} />
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-muted">{label}</div>
      <div className="text-xl font-extrabold">{value}</div>
    </div>
  );
}
