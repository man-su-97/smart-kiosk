import { formatRupees, type CartLine, type Product } from "./api";
import { KIND_BG, ProductIcon, kindOf } from "./ProductIcon";

// Floating button at the bottom. The count "bumps" every time it changes,
// because the changing `key` makes React replay the CSS animation.
export function CartPill({ count, totalPaise, onOpen }: { count: number; totalPaise: number; onOpen: () => void }) {
  if (count === 0) return null;
  return (
    <button
      onClick={onOpen}
      aria-label="View cart"
      className="fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 animate-rise cursor-pointer items-center gap-3 rounded-full
        bg-ink py-3 pr-[22px] pl-3 text-[17px] font-semibold text-white shadow-[0_14px_34px_rgba(31,33,64,0.35)] transition hover:scale-105"
    >
      <span key={count} className="grid size-9 animate-bump place-items-center rounded-full bg-brand font-extrabold">
        {count}
      </span>
      <span>{count === 1 ? "1 item" : `${count} items`} · {formatRupees(totalPaise)}</span>
      <span className="ml-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm">View cart ▲</span>
    </button>
  );
}

// "✓ Cold Coffee added" message that slides up for a moment.
export function AddedToast({ text, id }: { text: string; id: number }) {
  return (
    <div className="fixed bottom-[92px] left-1/2 z-30 -translate-x-1/2" key={id}>
      <div
        role="status"
        className="flex animate-toast items-center gap-2.5 rounded-full border-2 border-ok bg-white px-5 py-3 font-bold shadow-card"
      >
        <span className="grid size-6 place-items-center rounded-full bg-ok text-sm text-white">✓</span> {text}
      </div>
    </div>
  );
}

type DrawerProps = {
  lines: CartLine[];
  totalPaise: number;
  placing: boolean;
  error: string;
  onChange: (product: Product, delta: number) => void;
  onClose: () => void;
  onPlace: () => void;
};

// Slide-up panel listing everything in the cart, with quantity controls.
export function CartDrawer({ lines, totalPaise, placing, error, onChange, onClose, onPlace }: DrawerProps) {
  return (
    <div className="fixed inset-0 z-40 flex animate-fade items-end justify-center bg-ink/45" onClick={onClose}>
      <aside
        role="dialog"
        aria-label="Your cart"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-[640px] animate-slide-up overflow-y-auto rounded-t-[28px] bg-white p-[22px]"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-2xl font-extrabold">Your cart</h2>
          <button className="btn size-11 rounded-full p-0" onClick={onClose} aria-label="Close cart">✕</button>
        </div>

        {lines.length === 0 && <p className="text-muted">Your cart is empty. Tap + on a snack to add it.</p>}

        <ul>
          {lines.map(({ product, quantity }) => (
            <li
              key={product.id}
              className="grid grid-cols-[56px_1fr_auto] items-center gap-3 border-b border-line py-3 sm:grid-cols-[56px_1fr_auto_80px]"
            >
              <div className={`grid size-14 place-items-center rounded-[14px] ${KIND_BG[kindOf(product.name)]}`}>
                <ProductIcon name={product.name} className="size-10" />
              </div>
              <div className="flex flex-col">
                <strong>{product.name}</strong>
                <span className="text-muted">{formatRupees(product.pricePaise)} each</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button className="btn size-10 rounded-xl p-0 text-[22px]" aria-label={`Decrease ${product.name}`} onClick={() => onChange(product, -1)}>
                  −
                </button>
                <span className="qty-value min-w-6 text-center text-lg font-extrabold">{quantity}</span>
                <button
                  className="btn size-10 rounded-xl bg-brand p-0 text-[22px] text-white disabled:bg-soft disabled:text-ink"
                  aria-label={`Increase ${product.name}`}
                  onClick={() => onChange(product, 1)}
                  disabled={quantity >= product.available}
                >
                  +
                </button>
              </div>
              <div className="col-span-3 font-extrabold sm:col-span-1 sm:text-right">
                {formatRupees(product.pricePaise * quantity)}
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4">
          <div className="mb-3 text-2xl font-extrabold">Total: {formatRupees(totalPaise)}</div>
          {error && <p className="font-bold text-bad">{error}</p>}
          <button className="btn btn-primary w-full hover:enabled:scale-100" disabled={lines.length === 0 || placing} onClick={onPlace}>
            {placing ? "Placing…" : "Place order"}
          </button>
        </div>
      </aside>
    </div>
  );
}
