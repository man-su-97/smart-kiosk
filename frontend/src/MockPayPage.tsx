import { useEffect, useState } from "react";
import { fetchOrder, formatRupees, mockUpiPay, type Order } from "./api";

// Opened on a phone by scanning the kiosk's QR code. It stands in for a UPI app:
// shows the amount (read from the server, not from the link) and one Approve button.
export function MockPayPage() {
  const orderId = new URLSearchParams(window.location.search).get("orderId") ?? "";
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<"idle" | "paying" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchOrder(orderId)
      .then(setOrder)
      .catch((e) => {
        setState("error");
        setMessage(e.message);
      });
  }, [orderId]);

  const approve = async () => {
    setState("paying");
    try {
      const { result } = await mockUpiPay(orderId);
      setState(result === "paid" || result === "duplicate" || result === "already_paid" ? "done" : "error");
      setMessage(result === "needs_review" ? "Payment needs a staff check." : "");
    } catch (e) {
      setState("error");
      setMessage((e as Error).message);
    }
  };

  const payable = order && (order.status === "pending" || order.status === "pending_cash_approval");

  return (
    <div className="phone">
      <div className="phone-card">
        <div className="phone-brand">Mock UPI</div>
        <p className="muted">Demo payment page — no real money moves.</p>
        {order && (
          <>
            <p className="muted">Paying to</p>
            <h2>Snack Kiosk</h2>
            <div className="phone-amount">{formatRupees(order.totalPaise)}</div>
            <p className="muted small-text">Order {order.id.slice(0, 8)}</p>
          </>
        )}

        {state === "done" && <div className="phone-ok">✓ Payment approved. Check the kiosk screen.</div>}
        {state === "error" && <p className="error">{message || "Payment failed"}</p>}
        {state !== "done" && payable && (
          <button className="primary wide" disabled={state === "paying"} onClick={approve}>
            {state === "paying" ? "Paying…" : "Approve Mock UPI Payment"}
          </button>
        )}
        {order && !payable && state !== "done" && <p className="muted">This order is {order.status}; nothing to pay.</p>}
      </div>
    </div>
  );
}
