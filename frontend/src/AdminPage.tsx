import { useEffect, useState } from "react";
import { approveCash, fetchCashRequests, formatRupees, rejectCash, type CashRequest } from "./api";

// Operator dashboard: lists cash orders waiting at the counter (refreshed every 2 s)
// with Approve / Reject. The token is typed in once; the server checks it on every call.
export function AdminPage() {
  const [token, setToken] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [requests, setRequests] = useState<CashRequest[]>([]);
  const [error, setError] = useState("");

  const load = () =>
    fetchCashRequests(token)
      .then((list) => {
        setRequests(list);
        setError("");
      })
      .catch((e) => {
        setError(e.message);
        setLoggedIn(false); // wrong token: back to the login form
      });

  useEffect(() => {
    if (!loggedIn) return;
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [loggedIn]);

  const act = async (action: typeof approveCash, id: string) => {
    try {
      await action(token, id);
    } catch (e) {
      setError((e as Error).message);
    }
    load();
  };

  if (!loggedIn) {
    return (
      <div className="mx-auto max-w-[860px] p-6">
        <h1 className="mb-4 text-3xl font-extrabold tracking-tight">Operator login</h1>
        <form
          className="card flex max-w-[360px] flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setLoggedIn(true);
          }}
        >
          <label htmlFor="token" className="font-semibold">Admin token</label>
          <input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="rounded-xl border-2 border-line p-3 outline-none focus:border-brand"
          />
          <button className="btn btn-primary" type="submit" disabled={!token}>Open dashboard</button>
          {error && <p className="font-bold text-bad">{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[860px] p-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Cash requests</h1>
      <p className="mb-4 text-muted">Take the cash at the counter, then approve. Refreshes every 2 seconds.</p>
      {error && <p className="font-bold text-bad">{error}</p>}
      {requests.length === 0 && <div className="card text-muted">No customers waiting to pay cash.</div>}
      <div className="flex flex-col gap-3.5">
        {requests.map((r) => (
          <div key={r.id} data-testid="cash-request" className="card flex animate-pop flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[28px] font-extrabold">{formatRupees(r.totalPaise)}</div>
              <div className="text-[13px] text-muted">Order {r.id.slice(0, 8)} · {r.expiresInSeconds}s left</div>
              <div>{r.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</div>
            </div>
            <div className="flex gap-2.5">
              <button className="btn btn-primary" onClick={() => act(approveCash, r.id)}>Approve Cash Received</button>
              <button className="btn btn-ghost" onClick={() => act(rejectCash, r.id)}>Reject</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
