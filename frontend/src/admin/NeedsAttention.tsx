import { useEffect, useState } from "react";
import { formatRupees } from "../api";
import { fetchAttention, type AttentionItem } from "./adminApi";

const REASONS: Record<string, string> = {
  AMOUNT_MISMATCH: "paid a different amount than the bill",
  LATE_PAYMENT_STOCK_GONE: "paid after the hold ended and the items were sold",
};

// Payments a person must sort out before they turn into lost money or an angry customer.
export function NeedsAttention() {
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  useEffect(() => {
    fetchAttention().then(setItems).catch(() => setItems([]));
  }, []);
  if (!items) return null;

  return (
    <div className="card" data-testid="needs-attention">
      <h2 className="mb-2 font-bold">Needs attention {items.length > 0 && <span className="ml-1 rounded-full bg-bad px-2 py-0.5 text-xs text-white">{items.length}</span>}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing to sort out. 👍</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {items.map((item) => (
            <li key={`${item.kind}-${item.orderId}-${item.at}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <strong className={item.kind === "paid_twice" ? "text-bad" : "text-[#8a5a00]"}>
                  {item.kind === "paid_twice" ? "Paid twice" : "Needs review"}
                </strong>{" "}
                · {item.billNo}
                {item.kiosk && ` · ${item.kiosk}`} ·{" "}
                {item.kind === "paid_twice"
                  ? `second payment by ${item.detail}${item.person ? ` (taken by ${item.person})` : ""}: refund it`
                  : REASONS[item.detail] ?? item.detail}
              </span>
              <strong>{formatRupees(item.amountPaise)}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
