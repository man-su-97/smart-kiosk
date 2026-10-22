import { useEffect, useState } from "react";
import { fetchProducts, formatRupees, placeOrder, type CartLine, type Order, type Product } from "./api";
import { KIND_BG, ProductIcon, kindOf } from "./ProductIcon";
import { AddedToast, CartDrawer, CartPill } from "./CartDrawer";
import { Stepper } from "./Stepper";

const LOW_STOCK = 3;

// Green = plenty, orange = running low, red = none left.
// ("badge green/orange/red" are plain marker names the browser tests look for.)
function StockBadge({ available }: { available: number }) {
  const [marker, color, text] =
    available === 0
      ? ["red", "bg-bad", "Sold out"]
      : available <= LOW_STOCK
        ? ["orange", "bg-warn", `Only ${available} left`]
        : ["green", "bg-ok", `${available} in stock`];
  return (
    <span className={`badge ${marker} absolute top-6 left-6 z-10 rounded-full px-2.5 py-1 text-xs font-bold text-white ${color}`}>
      {text}
    </span>
  );
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
      <h1 className="mt-2 mb-1 text-3xl font-extrabold tracking-tight">What would you like?</h1>
      <p className="text-muted">Tap + to add a snack. Pay on the next screen with UPI or cash.</p>

      <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-[18px]">
        {products.map((p) => {
          const inCart = cart[p.id] ?? 0;
          return (
            <div
              key={p.id}
              data-testid="product"
              className={`group relative flex flex-col items-center rounded-3xl bg-white p-4 shadow-card transition
                hover:-translate-y-1 hover:shadow-[0_16px_36px_rgba(31,33,64,0.14)] ${p.available === 0 ? "opacity-50" : ""}`}
            >
              <StockBadge available={p.available} />
              <div className={`mb-3 grid h-[130px] w-full place-items-center rounded-[18px] ${KIND_BG[kindOf(p.name)]}`}>
                <ProductIcon name={p.name} className="size-24 transition group-hover:scale-110 group-hover:-rotate-3" />
              </div>
              <div className="text-center text-[17px] font-bold">{p.name}</div>
              <div className="mt-0.5 mb-3 text-[19px] font-extrabold text-brand-dark">{formatRupees(p.pricePaise)}</div>
              <div className="flex items-center gap-3.5">
                <button
                  className="btn size-14 rounded-[18px] p-0 text-[28px] font-bold"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => change(p, -1)}
                  disabled={inCart === 0}
                >
                  −
                </button>
                <span className="qty-value min-w-8 text-center text-2xl font-extrabold">{inCart}</span>
                <button
                  className="btn size-14 rounded-[18px] bg-brand p-0 text-[28px] font-bold text-white disabled:bg-soft disabled:text-ink"
                  aria-label={`Add ${p.name}`}
                  onClick={() => change(p, 1)}
                  disabled={inCart >= p.available}
                >
                  +
                </button>
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
      {!cartOpen && error && <p className="font-bold text-bad">{error}</p>}
    </>
  );
}
