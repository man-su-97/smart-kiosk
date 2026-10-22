import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatRupees } from "../api";
import {
  fetchCategories,
  fetchDaily,
  fetchSummary,
  fetchTopProducts,
  type CategoryRow,
  type DailyRow,
  type Summary,
  type TopProduct,
} from "./adminApi";
import { todayInIndia } from "./format";

type Data = { summary: Summary; daily: DailyRow[]; categories: CategoryRow[]; top: TopProduct[] };

// Charts show rupees; the API returns paise.
const toRupees = (paise: number) => paise / 100;

export function Dashboard() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const range = { from: todayInIndia(-(days - 1)), to: todayInIndia() };
    Promise.all([fetchSummary(range), fetchDaily(range), fetchCategories(range), fetchTopProducts(range)])
      .then(([summary, daily, categories, top]) => setData({ summary, daily, categories, top }))
      .catch((e) => setError(e.message));
  }, [days]);

  if (error) return <p className="font-bold text-bad">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;
  const { summary, daily, categories, top } = data;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
        <div className="flex gap-1.5 rounded-xl bg-soft p-1" role="group" aria-label="Period">
          {[7, 30].map((n) => (
            <button key={n} onClick={() => setDays(n)} className={`btn px-3 py-1.5 text-sm ${days === n ? "bg-white" : "bg-transparent"}`}>
              Last {n} days
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <Kpi label="Revenue" value={formatRupees(summary.revenuePaise)} />
        <Kpi label="Profit" value={formatRupees(summary.profitPaise)} />
        <Kpi label="Orders" value={String(summary.orders)} sub={`${summary.units} units`} />
        <Kpi label="Cash collected" value={formatRupees(summary.cashCollectedPaise)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card" data-testid="chart-daily">
          <h2 className="mb-3 font-bold">Daily revenue (₹)</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={daily.map((d) => ({ day: d.day.slice(5), revenue: toRupees(d.revenuePaise), profit: toRupees(d.profitPaise) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e8f2" />
              <XAxis dataKey="day" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => `₹${Number(v).toFixed(2)}`} />
              <Line type="monotone" dataKey="revenue" stroke="#ff6a3d" strokeWidth={3} dot={false} name="Revenue" isAnimationActive={false} />
              <Line type="monotone" dataKey="profit" stroke="#1fb26b" strokeWidth={2} dot={false} name="Profit" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card" data-testid="chart-categories">
          <h2 className="mb-3 font-bold">Units sold by category</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={categories}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e8f2" />
              <XAxis dataKey="category" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Bar dataKey="units" fill="#1f2140" radius={[8, 8, 0, 0]} name="Units" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Table
          title="Top products"
          head={["Product", "Units", "Revenue", "Profit"]}
          rows={top.map((p) => [p.name, String(p.units), formatRupees(p.revenuePaise), formatRupees(p.profitPaise)])}
        />
        <Table
          title="Cash collected by staff"
          head={["Staff", "Approvals", "Amount"]}
          rows={summary.cashByOperator.map((c) => [c.email, String(c.approvals), formatRupees(c.amountPaise)])}
        />
      </div>
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4" data-testid="kpi">
      <div className="text-sm text-muted">{label}</div>
      <div className="text-2xl font-extrabold">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <div className="card">
      <h2 className="mb-2 font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No sales in this period.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">{head.map((h) => <th key={h} className="py-1.5 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="py-1.5">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
