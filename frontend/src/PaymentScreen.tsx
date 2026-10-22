import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { fetchOrder, formatRupees, mockUpiPay, requestCash, type CartLine, type Order } from "./api";
import { useCountdown } from "./useCountdown";
import { Stepper } from "./Stepper";
import { LockerAnimation } from "./LockerAnimation";

const FINISHED = ["paid", "expired", "cancelled", "needs_review", "claimed"];

// The QR opens our own mock UPI page on the phone (a real upi:// link would open GPay,
// which cannot pay a demo). Only the order id goes in the link; the page reads the
// amount from the server. Open the kiosk via the computer's LAN IP so a phone can reach it.
function mockPayLink(order: Order) {
  return `${window.location.origin}/mock-pay?orderId=${order.id}`;
}

// Big icon + title + message, used for the expired / declined / needs-review endings.
function Ending({ tone, icon, title, children, onDone }: {
  tone: "bad" | "warn"; icon: string; title: string; children: React.ReactNode; onDone: () => void;
}) {
  return (
    <div className={`animate-pop rounded-[28px] p-7 text-center ${tone === "bad" ? "bg-[#fde7e7]" : "bg-[#fff1cf]"}`}>
      <Stepper step={2} center />
      <div className="mx-auto grid size-20 place-items-center rounded-full bg-ink text-[40px] text-white">{icon}</div>
      <h1 className="my-2.5 text-3xl font-extrabold">{title}</h1>
      <div className="mb-5 space-y-2">{children}</div>
      <button className="btn btn-primary" onClick={onDone}>Back to shop</button>
    </div>
  );
}

const tabClass = (active: boolean) =>
  `btn p-3.5 text-[17px] ${active ? "bg-white shadow-[0_4px_12px_rgba(31,33,64,0.12)]" : "bg-transparent"}`;

type Props = { firstOrder: Order; lines: CartLine[]; onDone: () => void };

export function PaymentScreen({ firstOrder, lines, onDone }: Props) {
  const [order, setOrder] = useState(firstOrder);
  const [method, setMethod] = useState<"upi" | "cash">("upi");
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState("");
  const secondsLeft = useCountdown(order.expiresInSeconds);
  const finished = FINISHED.includes(order.status);
  const command = `npm run send-webhook -- ${order.id} ${order.totalPaise}`;

  // Ask the server for the status every 2 seconds until the order is finished.
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
      <div className="text-center">
        <Stepper step={3} center />
        <LockerAnimation />
        <h1 className="animate-pop text-4xl font-extrabold text-[#167a4a] [animation-delay:0.2s] [animation-fill-mode:backwards]">
          Payment Received
        </h1>
        <p className="mt-1.5 mb-6 animate-pop text-lg [animation-delay:0.4s] [animation-fill-mode:backwards]">
          <strong>Locker Unlocked</strong> — collect your order from the locker.
        </p>
        <button className="btn btn-primary" onClick={onDone}>Done</button>
      </div>
    );
  }

  if (order.status === "cancelled") {
    return (
      <Ending tone="bad" icon="✕" title="Cash payment declined" onDone={onDone}>
        <p>The operator cancelled this order and your items were released.</p>
      </Ending>
    );
  }
  if (order.status === "expired") {
    return (
      <Ending tone="bad" icon="⌛" title="Time ran out" onDone={onDone}>
        <p>Your items were released. Please start a new order.</p>
      </Ending>
    );
  }
  if (order.status === "needs_review") {
    return (
      <Ending tone="warn" icon="!" title="Please ask staff" onDone={onDone}>
        <p>We got your payment but could not confirm it automatically.</p>
        <p>Show this order id: <code className="rounded-md bg-soft px-1.5 py-0.5">{order.id}</code></p>
      </Ending>
    );
  }

  return (
    <>
      <Stepper step={2} />
      <div className="grid items-start gap-5 md:grid-cols-[1fr_1.25fr]">
        {/* Left: what you are paying for */}
        <section className="summary card">
          <h2 className="mb-2.5 text-xl font-extrabold">Order summary</h2>
          <ul>
            {lines.map(({ product, quantity }) => (
              <li key={product.id} className="flex justify-between border-b border-dashed border-line py-2">
                <span>{quantity} × {product.name}</span>
                <span>{formatRupees(product.pricePaise * quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between py-3.5 text-[22px]">
            <span>Total</span>
            <strong>{formatRupees(order.totalPaise)}</strong>
          </div>
          <div
            className={`flex flex-col items-center rounded-[20px] p-3 text-white ${
              secondsLeft <= 30 ? "animate-pulse-soft bg-bad" : "bg-ink"
            }`}
          >
            <span className="text-xs opacity-70">Items held for</span>
            <span className="countdown text-[40px] font-extrabold tabular-nums">{timeText}</span>
          </div>
          <p className="mt-3 text-[13px] text-muted">
            Order <code className="order-id rounded-md bg-soft px-1.5 py-0.5 break-all">{order.id}</code>
          </p>
        </section>

        {/* Right: how you pay */}
        <section className="card">
          <h1 className="mt-2 mb-1 text-3xl font-extrabold tracking-tight">Pay {formatRupees(order.totalPaise)}</h1>
          {/* Once cash is requested the choice is made, so the tabs go away. */}
          {order.status === "pending" && (
            <div className="my-3.5 grid grid-cols-2 gap-1.5 rounded-[18px] bg-soft p-1.5" role="tablist">
              <button role="tab" aria-selected={method === "upi"} className={tabClass(method === "upi")} onClick={() => setMethod("upi")}>
                📱 UPI
              </button>
              <button role="tab" aria-selected={method === "cash"} className={tabClass(method === "cash")} onClick={() => setMethod("cash")}>
                💵 Cash
              </button>
            </div>
          )}

          {order.status === "pending_cash_approval" ? (
            <div className="flex flex-col items-center text-center" data-testid="cash-waiting">
              <div className="my-2 animate-pulse-soft text-[64px]">💵</div>
              <p className="mt-3 mb-1 text-lg font-bold">Please pay {formatRupees(order.totalPaise)} in cash at the counter</p>
              <p className="text-muted">Awaiting operator approval… this screen updates by itself.</p>
            </div>
          ) : method === "upi" ? (
            <div className="flex flex-col items-center text-center">
              <div className="qr-box rounded-[22px] border-2 border-line bg-white p-3">
                <QRCodeSVG value={mockPayLink(order)} size={200} marginSize={2} />
              </div>
              <p className="mt-3 mb-1 text-lg font-bold">Scan with your phone camera</p>
              <p className="text-[13px] text-muted">Opens a demo UPI page — no real money moves.</p>
              <div className="mt-3.5 flex w-full flex-col items-center gap-2 rounded-[18px] border-2 border-dashed border-line p-3">
                <small>Testing without a phone</small>
                <button className="btn btn-primary" onClick={() => run(() => mockUpiPay(order.id))}>
                  Simulate UPI Payment Success
                </button>
                <small>or send a signed webhook from a terminal:</small>
                <code className="command max-w-full overflow-x-auto rounded-md bg-soft px-1.5 py-0.5 text-xs whitespace-nowrap">
                  {command}
                </code>
                <button className="btn btn-ghost" onClick={copy}>{copied ? "Copied!" : "Copy command"}</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center" data-testid="cash-panel">
              <div className="my-2 text-[64px]">💵</div>
              <p className="mt-3 mb-1 text-lg font-bold">Pay {formatRupees(order.totalPaise)} in cash at the counter</p>
              <p className="mb-4 text-muted">The operator confirms the cash, then your locker unlocks.</p>
              <button className="btn btn-primary" onClick={() => run(() => requestCash(order.id))}>Pay with Cash</button>
            </div>
          )}
          {actionError && <p className="mt-3 font-bold text-bad">{actionError}</p>}
        </section>
      </div>
    </>
  );
}
