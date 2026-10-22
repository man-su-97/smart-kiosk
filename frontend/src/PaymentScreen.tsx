import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { fetchOrder, formatRupees, type Order } from "./api";
import { useCountdown } from "./useCountdown";

const FINISHED = ["paid", "expired", "needs_review", "claimed"];

// UPI deep link. UPI wants rupees (e.g. 45.00), so this is the one place paise
// is converted, and only for the QR text.
function upiLink(order: Order) {
  const rupees = (order.totalPaise / 100).toFixed(2);
  return `upi://pay?pa=counter@upi&pn=SnackKiosk&am=${rupees}&tr=${order.id}&tn=Order_${order.id}&cu=INR`;
}

export function PaymentScreen({ firstOrder, onDone }: { firstOrder: Order; onDone: () => void }) {
  const [order, setOrder] = useState(firstOrder);
  const [copied, setCopied] = useState(false);
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

  return (
    <div className="pay-card">
      {order.status === "pending" && (
        <>
          <h1 className="screen-title">Pay {formatRupees(order.totalPaise)} by UPI</h1>
          <div className={`timer-badge ${secondsLeft <= 30 ? "urgent" : ""}`}>
            ⏱ <span className="countdown">{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</span>
          </div>
          <div className="qr-box">
            <QRCodeSVG value={upiLink(order)} size={220} marginSize={2} />
          </div>
          <p className="scan-text">Scan with GPay / PhonePe / Paytm</p>
          <p>Order <code className="order-id">{order.id}</code></p>

          <div className="demo-box">
            <small>Testing: pretend to be the payment provider</small>
            <code className="command">{command}</code>
            <button onClick={copy}>{copied ? "Copied!" : "Copy command"}</button>
          </div>
        </>
      )}

      {order.status === "paid" && (
        <div className="result ok">
          <div className="result-icon">✔</div>
          <h1>Payment Received</h1>
          <p>Locker Unlocked — go and collect your order.</p>
        </div>
      )}
      {order.status === "expired" && (
        <div className="result bad">
          <div className="result-icon">⌛</div>
          <h1>Time ran out</h1>
          <p>Your items were released. Please start a new order.</p>
        </div>
      )}
      {order.status === "needs_review" && (
        <div className="result warn">
          <div className="result-icon">!</div>
          <h1>Please ask staff</h1>
          <p>We got your payment but could not confirm it automatically. Show this order id: <code>{order.id}</code></p>
        </div>
      )}
      {order.status === "claimed" && (
        <div className="result ok">
          <div className="result-icon">✔</div>
          <h1>Already collected</h1>
        </div>
      )}

      {finished && <button className="primary" onClick={onDone}>Back to shop</button>}
    </div>
  );
}
