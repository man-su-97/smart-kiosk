import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { fetchOrder, formatRupees, mockUpiPay, requestCash, type CartLine, type Order } from "./api";
import { useCountdown } from "./useCountdown";
import { Stepper } from "./Stepper";
import { LockerAnimation } from "./LockerAnimation";

const FINISHED = ["paid", "expired", "needs_review", "claimed"];

// The QR opens our own mock UPI page on the phone (a real upi:// link would open GPay,
// which cannot pay a demo). Only the order id goes in the link; the page reads the
// amount from the server. Open the kiosk via the computer's LAN IP so a phone can reach it.
function mockPayLink(order: Order) {
  return `${window.location.origin}/mock-pay?orderId=${order.id}`;
}

type Props = { firstOrder: Order; lines: CartLine[]; onDone: () => void };

export function PaymentScreen({ firstOrder, lines, onDone }: Props) {
  const [order, setOrder] = useState(firstOrder);
  const [method, setMethod] = useState<"upi" | "cash">("upi");
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState("");
  const secondsLeft = useCountdown(order.expiresInSeconds);
  const finished = FINISHED.includes(order.status);
  const command = `npm run send-webhook -- ${order.id} ${order.totalPaise}`;

  // Ask the server for the status every 2 seconds until it is paid / expired / needs_review.
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => {
      fetchOrder(order.id).then(setOrder).catch(() => {}); // ignore a failed poll, try again next time
    }, 2000);
    return () => clearInterval(timer);
  }, [order.id, finished]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the command is still visible to copy by hand */
    }
  };

  // Both buttons call the server, then refresh the order right away (no need to wait for the poll).
  const run = async (action: () => Promise<unknown>) => {
    setActionError("");
    try {
      await action();
      setOrder(await fetchOrder(order.id));
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const timeText = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  if (order.status === "paid" || order.status === "claimed") {
    return (
      <div className="pay-done">
        <Stepper step={3} />
        <LockerAnimation />
        <h1 className="done-title">Payment Received</h1>
        <p className="done-sub">
          <strong>Locker Unlocked</strong> — collect your order from the locker.
        </p>
        <button className="primary" onClick={onDone}>Done</button>
      </div>
    );
  }

  if (order.status === "cancelled") {
    return (
      <div className="result bad">
        <Stepper step={2} />
        <div className="result-icon">✕</div>
        <h1>Cash payment declined</h1>
        <p>The operator cancelled this order and your items were released.</p>
        <button className="primary" onClick={onDone}>Back to shop</button>
      </div>
    );
  }

  if (order.status === "expired" || order.status === "needs_review") {
    const expired = order.status === "expired";
    return (
      <div className={`result ${expired ? "bad" : "warn"}`}>
        <Stepper step={2} />
        <div className="result-icon">{expired ? "⌛" : "!"}</div>
        <h1>{expired ? "Time ran out" : "Please ask staff"}</h1>
        <p>
          {expired
            ? "Your items were released. Please start a new order."
            : "We got your payment but could not confirm it automatically."}
        </p>
        {!expired && <p>Show this order id: <code>{order.id}</code></p>}
        <button className="primary" onClick={onDone}>Back to shop</button>
      </div>
    );
  }

  return (
    <>
      <Stepper step={2} />
      <div className="pay-layout">
        {/* Left: what you are paying for */}
        <section className="card summary">
          <h2>Order summary</h2>
          <ul className="summary-lines">
            {lines.map(({ product, quantity }) => (
              <li key={product.id}>
                <span>{quantity} × {product.name}</span>
                <span>{formatRupees(product.pricePaise * quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="summary-total">
            <span>Total</span>
            <strong>{formatRupees(order.totalPaise)}</strong>
          </div>
          <div className={`timer-badge ${secondsLeft <= 30 ? "urgent" : ""}`}>
            <span className="muted-on-dark">Items held for</span>
            <span className="countdown">{timeText}</span>
          </div>
          <p className="muted small-text">Order <code className="order-id">{order.id}</code></p>
        </section>

        {/* Right: how you pay */}
        <section className="card pay-methods">
          <h1 className="screen-title">Pay {formatRupees(order.totalPaise)}</h1>
          {/* Once cash is requested the choice is made, so the tabs go away. */}
          {order.status === "pending" && (
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={method === "upi"} className={method === "upi" ? "tab active" : "tab"} onClick={() => setMethod("upi")}>
                📱 UPI
              </button>
              <button role="tab" aria-selected={method === "cash"} className={method === "cash" ? "tab active" : "tab"} onClick={() => setMethod("cash")}>
                💵 Cash
              </button>
            </div>
          )}

          {order.status === "pending_cash_approval" ? (
            <div className="method-body" data-testid="cash-waiting">
              <div className="cash-wait-icon">💵</div>
              <p className="scan-text">Please pay {formatRupees(order.totalPaise)} in cash at the counter</p>
              <p className="muted">Awaiting operator approval… this screen updates by itself.</p>
            </div>
          ) : method === "upi" ? (
            <div className="method-body">
              <div className="qr-box">
                <QRCodeSVG value={mockPayLink(order)} size={200} marginSize={2} />
              </div>
              <p className="scan-text">Scan with your phone camera</p>
              <p className="muted small-text">Opens a demo UPI page — no real money moves.</p>
              <div className="demo-box">
                <small>Testing without a phone</small>
                <button className="primary" onClick={() => run(() => mockUpiPay(order.id))}>
                  Simulate UPI Payment Success
                </button>
                <small>or send a signed webhook from a terminal:</small>
                <code className="command">{command}</code>
                <button className="ghost" onClick={copy}>{copied ? "Copied!" : "Copy command"}</button>
              </div>
            </div>
          ) : (
            <div className="method-body" data-testid="cash-panel">
              <div className="cash-wait-icon">💵</div>
              <p className="scan-text">Pay {formatRupees(order.totalPaise)} in cash at the counter</p>
              <p className="muted">The operator confirms the cash, then your locker unlocks.</p>
              <button className="primary" onClick={() => run(() => requestCash(order.id))}>Pay with Cash</button>
            </div>
          )}
          {actionError && <p className="error">{actionError}</p>}
        </section>
      </div>
    </>
  );
}
