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
      <div className="admin">
        <h1 className="screen-title">Operator login</h1>
        <form
          className="card admin-login"
          onSubmit={(e) => {
            e.preventDefault();
            setLoggedIn(true);
          }}
        >
          <label htmlFor="token">Admin token</label>
          <input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="primary" type="submit" disabled={!token}>Open dashboard</button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="admin">
      <h1 className="screen-title">Cash requests</h1>
      <p className="muted">Take the cash at the counter, then approve. Refreshes every 2 seconds.</p>
      {error && <p className="error">{error}</p>}
      {requests.length === 0 && <div className="card muted">No customers waiting to pay cash.</div>}
      <div className="admin-list">
        {requests.map((r) => (
          <div className="card admin-request" key={r.id} data-testid="cash-request">
            <div>
              <div className="admin-amount">{formatRupees(r.totalPaise)}</div>
              <div className="muted small-text">Order {r.id.slice(0, 8)} · {r.expiresInSeconds}s left</div>
              <div>{r.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</div>
            </div>
            <div className="admin-actions">
              <button className="primary" onClick={() => act(approveCash, r.id)}>Approve Cash Received</button>
              <button className="ghost" onClick={() => act(rejectCash, r.id)}>Reject</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
