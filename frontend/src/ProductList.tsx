import { useEffect, useState } from "react";
import { fetchProducts, formatRupees, placeOrder, type CartLine, type Order, type Product } from "./api";
import { ProductIcon, kindOf } from "./ProductIcon";
import { AddedToast, CartDrawer, CartPill } from "./CartDrawer";
import { Stepper } from "./Stepper";

const LOW_STOCK = 3;

// Green = plenty, orange = running low, red = none left.
function StockBadge({ available }: { available: number }) {
  if (available === 0) return <span className="badge red">Sold out</span>;
  if (available <= LOW_STOCK) return <span className="badge orange">Only {available} left</span>;
  return <span className="badge green">{available} in stock</span>;
}

export function ProductList({ onOrderPlaced }: { onOrderPlaced: (order: Order, lines: CartLine[]) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<number, number>>({}); // productId -> quantity
  const [cartOpen, setCartOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");

  const load = () => fetchProducts().then(setProducts).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  // Hide the "added" message after a moment.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  // Never let the cart go below 0 or above what is available.
  const change = (product: Product, delta: number) => {
    const current = cart[product.id] ?? 0;
    const next = Math.min(product.available, Math.max(0, current + delta));
    if (next === current) return;
    setCart({ ...cart, [product.id]: next });
    if (delta > 0) setToast({ text: `${product.name} added to cart`, id: (toast?.id ?? 0) + 1 });
  };

  const lines: CartLine[] = products
    .filter((p) => (cart[p.id] ?? 0) > 0)
    .map((p) => ({ product: p, quantity: cart[p.id] }));
  const count = lines.reduce((sum, l) => sum + l.quantity, 0);
  const totalPaise = lines.reduce((sum, l) => sum + l.product.pricePaise * l.quantity, 0);

  // Close the drawer automatically if the last item is removed.
  useEffect(() => {
    if (count === 0) setCartOpen(false);
  }, [count]);

  const submit = async () => {
    setError("");
    setPlacing(true);
    try {
      const order = await placeOrder(lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })));
      onOrderPlaced(order, lines);
    } catch (e) {
      setError((e as Error).message);
      load(); // stock probably changed, show fresh numbers
    } finally {
      setPlacing(false);
    }
  };

  return (
    <>
      <Stepper step={1} />
      <h1 className="screen-title">What would you like?</h1>
      <p className="muted">Tap + to add a snack. Pay on the next screen with UPI or cash.</p>

      <div className="grid">
        {products.map((p) => {
          const inCart = cart[p.id] ?? 0;
          return (
            <div className={`product ${p.available === 0 ? "sold-out" : ""}`} key={p.id} data-testid="product">
              <StockBadge available={p.available} />
              <div className={`icon-wrap kind-${kindOf(p.name)}`}>
                <ProductIcon name={p.name} />
              </div>
              <div className="product-name">{p.name}</div>
              <div className="product-price">{formatRupees(p.pricePaise)}</div>
              <div className="qty">
                <button aria-label={`Remove ${p.name}`} onClick={() => change(p, -1)} disabled={inCart === 0}>−</button>
                <span className="qty-value">{inCart}</span>
                <button aria-label={`Add ${p.name}`} onClick={() => change(p, 1)} disabled={inCart >= p.available}>+</button>
              </div>
            </div>
          );
        })}
      </div>

      {toast && <AddedToast text={toast.text} id={toast.id} />}
      <CartPill count={count} totalPaise={totalPaise} onOpen={() => setCartOpen(true)} />
      {cartOpen && (
        <CartDrawer
          lines={lines}
          totalPaise={totalPaise}
          placing={placing}
          error={error}
          onChange={change}
          onClose={() => setCartOpen(false)}
          onPlace={submit}
        />
      )}
      {!cartOpen && error && <p className="error">{error}</p>}
    </>
  );
}
