import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { fetchOrder, formatRupees, payCash, type CartLine, type Order } from "./api";
import { useCountdown } from "./useCountdown";
import { Stepper } from "./Stepper";
import { LockerAnimation } from "./LockerAnimation";

const FINISHED = ["paid", "expired", "needs_review", "claimed"];

// UPI deep link. UPI wants rupees (e.g. 45.00), so this is the one place paise
// is converted, and only for the QR text.
function upiLink(order: Order) {
  const rupees = (order.totalPaise / 100).toFixed(2);
  return `upi://pay?pa=counter@upi&pn=SnackKiosk&am=${rupees}&tr=${order.id}&tn=Order_${order.id}&cu=INR`;
}

type Props = { firstOrder: Order; lines: CartLine[]; onDone: () => void };

export function PaymentScreen({ firstOrder, lines, onDone }: Props) {
  const [order, setOrder] = useState(firstOrder);
  const [method, setMethod] = useState<"upi" | "cash">("upi");
  const [copied, setCopied] = useState(false);
  const [cashError, setCashError] = useState("");
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

  // Demo cash acceptor. The next poll (or this fetch) picks up the new status.
  const simulateCash = async () => {
    setCashError("");
    try {
      await payCash(order.id);
      setOrder(await fetchOrder(order.id));
    } catch (e) {
      setCashError((e as Error).message);
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
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={method === "upi"} className={method === "upi" ? "tab active" : "tab"} onClick={() => setMethod("upi")}>
              📱 UPI
            </button>
            <button role="tab" aria-selected={method === "cash"} className={method === "cash" ? "tab active" : "tab"} onClick={() => setMethod("cash")}>
              💵 Cash
            </button>
          </div>

          {method === "upi" ? (
            <div className="method-body">
              <div className="qr-box">
                <QRCodeSVG value={upiLink(order)} size={200} marginSize={2} />
              </div>
              <p className="scan-text">Scan with GPay / PhonePe / Paytm</p>
              <div className="demo-box">
                <small>Testing: pretend to be the payment provider</small>
                <code className="command">{command}</code>
                <button className="ghost" onClick={copy}>{copied ? "Copied!" : "Copy command"}</button>
              </div>
            </div>
          ) : (
            <div className="method-body" data-testid="cash-panel">
              <div className="cash-slot">
                <div className="cash-note">{formatRupees(order.totalPaise)}</div>
                <div className="cash-slot-bar" />
              </div>
              <p className="scan-text">Insert {formatRupees(order.totalPaise)} in the cash slot</p>
              <p className="muted">The kiosk does not give change, so insert the exact amount.</p>
              <div className="demo-box">
                <small>Testing: no cash hardware here</small>
                <button className="primary" onClick={simulateCash}>Simulate cash inserted</button>
                {cashError && <p className="error">{cashError}</p>}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
