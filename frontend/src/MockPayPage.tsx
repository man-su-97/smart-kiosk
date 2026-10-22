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
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-[#5b4bdb] to-[#2a1f7a] p-4">
      <div className="w-full max-w-[380px] rounded-[28px] bg-white px-[22px] py-7 text-center shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
        <div className="text-xl font-extrabold text-[#5b4bdb]">Mock UPI</div>
        <p className="text-muted">Demo payment page — no real money moves.</p>
        {order && (
          <>
            <p className="mt-3 text-muted">Paying to</p>
            <h2 className="text-2xl font-bold">Snack Kiosk</h2>
            <div className="my-2 text-[44px] font-extrabold">{formatRupees(order.totalPaise)}</div>
            <p className="mb-4 text-[13px] text-muted">Order {order.id.slice(0, 8)}</p>
          </>
        )}

        {state === "done" && (
          <div className="animate-pop rounded-2xl bg-[#dcf5e8] p-3.5 font-bold text-[#167a4a]">
            ✓ Payment approved. Check the kiosk screen.
          </div>
        )}
        {state === "error" && <p className="font-bold text-bad">{message || "Payment failed"}</p>}
        {state !== "done" && payable && (
          <button className="btn btn-primary w-full" disabled={state === "paying"} onClick={approve}>
            {state === "paying" ? "Paying…" : "Approve Mock UPI Payment"}
          </button>
        )}
        {order && !payable && state !== "done" && <p className="text-muted">This order is {order.status}; nothing to pay.</p>}
      </div>
    </div>
  );
}
