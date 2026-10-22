import { useEffect, useState } from "react";
import { fetchOrder, formatRupees, type Order } from "./api";
import { useCountdown } from "./useCountdown";

const FINISHED = ["paid", "expired", "needs_review", "claimed"];

export function PaymentScreen({ firstOrder, onDone }: { firstOrder: Order; onDone: () => void }) {
  const [order, setOrder] = useState(firstOrder);
  const secondsLeft = useCountdown(order.expiresInSeconds);
  const finished = FINISHED.includes(order.status);

  // Ask the server for the status every 2 seconds until it is paid / expired / needs_review.
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => {
      fetchOrder(order.id).then(setOrder).catch(() => {}); // ignore a failed poll, try again next time
    }, 2000);
    return () => clearInterval(timer);
  }, [order.id, finished]);

  return (
    <div>
      <h1>Pay {formatRupees(order.totalPaise)} by UPI</h1>
      <p>Order <code>{order.id}</code></p>

      {order.status === "pending" && (
        <>
          <div className="countdown">
            {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
          </div>
          <p>Waiting for payment… your items are held until the timer ends.</p>
          <small>
            Demo: simulate the provider with{" "}
            <code>npm run send-webhook -- {order.id} {order.totalPaise}</code>
          </small>
        </>
      )}
      {order.status === "paid" && (
        <div className="msg ok">Payment received! Go to the locker to collect your order.</div>
      )}
      {order.status === "expired" && (
        <div className="msg bad">Time ran out and your items were released. Please start a new order.</div>
      )}
      {order.status === "needs_review" && (
        <div className="msg warn">
          We got your payment but could not confirm it automatically. Please ask staff for help
          (order id above).
        </div>
      )}
      {order.status === "claimed" && <div className="msg ok">This order has already been collected.</div>}

      {finished && <button onClick={onDone}>Back to shop</button>}
    </div>
  );
}
