import { formatRupees, type CartLine, type Product } from "./api";
import { ProductIcon, kindOf } from "./ProductIcon";

// Floating button at the bottom. It "bumps" every time the item count changes,
// because the changing `key` makes React replay the CSS animation.
export function CartPill({ count, totalPaise, onOpen }: { count: number; totalPaise: number; onOpen: () => void }) {
  if (count === 0) return null;
  return (
    <button className="cart-pill" onClick={onOpen} aria-label="View cart">
      <span className="cart-count" key={count}>{count}</span>
      <span>{count === 1 ? "1 item" : `${count} items`} · {formatRupees(totalPaise)}</span>
      <span className="cart-pill-cta">View cart ▲</span>
    </button>
  );
}

// "✓ Cold Coffee added" message that slides up for a moment.
export function AddedToast({ text, id }: { text: string; id: number }) {
  return (
    <div className="toast" key={id} role="status">
      <span className="toast-check">✓</span> {text}
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
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label="Your cart" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>Your cart</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close cart">✕</button>
        </div>

        {lines.length === 0 && <p className="muted">Your cart is empty. Tap + on a snack to add it.</p>}

        <ul className="cart-lines">
          {lines.map(({ product, quantity }) => (
            <li key={product.id} className="cart-line">
              <div className={`mini-icon kind-${kindOf(product.name)}`}><ProductIcon name={product.name} /></div>
              <div className="cart-line-info">
                <strong>{product.name}</strong>
                <span className="muted">{formatRupees(product.pricePaise)} each</span>
              </div>
              <div className="qty small">
                <button aria-label={`Decrease ${product.name}`} onClick={() => onChange(product, -1)}>−</button>
                <span className="qty-value">{quantity}</span>
                <button aria-label={`Increase ${product.name}`} onClick={() => onChange(product, 1)}>+</button>
              </div>
              <div className="cart-line-total">{formatRupees(product.pricePaise * quantity)}</div>
            </li>
          ))}
        </ul>

        <div className="drawer-foot">
          <div className="cart-total">Total: {formatRupees(totalPaise)}</div>
          {error && <p className="error">{error}</p>}
          <button className="primary wide" disabled={lines.length === 0 || placing} onClick={onPlace}>
            {placing ? "Placing…" : "Place order"}
          </button>
        </div>
      </aside>
    </div>
  );
}
