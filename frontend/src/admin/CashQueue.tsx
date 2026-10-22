import { useEffect, useState } from "react";
import { formatRupees, type CashRequest } from "../api";
import { approveCash, fetchCashRequests, rejectCash } from "./adminApi";
import { MyDuty } from "./MyDuty";

// Customers waiting to pay cash at the counter. Refreshed every 2 seconds.
export function CashQueue() {
  const [requests, setRequests] = useState<CashRequest[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    fetchCashRequests()
      .then((list) => {
        setRequests(list);
        setError("");
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, []);

  async function act(action: typeof approveCash, id: string, done: string) {
    setMessage("");
    setError("");
    try {
      const { result } = await action(id);
      setMessage(result === "needs_review" ? "Cash recorded, but the items were gone: order needs review." : done);
    } catch (e) {
      setError((e as Error).message);
    }
    load();
  }

  return (
    <section>
      <MyDuty />
      <h1 className="text-3xl font-extrabold tracking-tight">Cash queue</h1>
      <p className="mb-4 text-muted">Take the cash at the counter, then approve. Your name is recorded with each approval.</p>
      {message && <p className="mb-3 rounded-xl bg-[#dcf5e8] p-3 font-semibold text-[#167a4a]" role="status">{message}</p>}
      {error && <p className="mb-3 font-bold text-bad">{error}</p>}
      {requests.length === 0 && <div className="card text-muted">No customers waiting to pay cash.</div>}
      <div className="flex flex-col gap-3.5">
        {requests.map((r) => (
          <div key={r.id} data-testid="cash-request" className="card flex animate-pop flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[28px] font-extrabold">{formatRupees(r.totalPaise)}</div>
              <div className="text-[13px] text-muted">
                Order {r.id.slice(0, 8)} ·{" "}
                {r.late ? (
                  <span className="rounded-full bg-[#fff1cf] px-2 py-0.5 font-bold text-[#8a5a00]">Late: approve only if the cash was handed over in time</span>
                ) : (
                  `${r.expiresInSeconds}s left`
                )}
              </div>
              <div>{r.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</div>
            </div>
            <div className="flex gap-2.5">
              <button className="btn btn-primary" onClick={() => act(approveCash, r.id, "Cash approved: the locker is unlocked.")}>
                Approve Cash Received
              </button>
              <button className="btn btn-ghost" onClick={() => act(rejectCash, r.id, "Rejected: the order was cancelled.")}>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
