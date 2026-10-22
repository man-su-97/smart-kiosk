import { useEffect, useState } from "react";
import { fetchProducts, formatRupees, placeOrder, type Order, type Product } from "./api";
import { ProductIcon } from "./ProductIcon";

const LOW_STOCK = 3;

// Green = plenty, orange = running low, red = none left.
function StockBadge({ available }: { available: number }) {
  if (available === 0) return <span className="badge red">Sold out</span>;
  if (available <= LOW_STOCK) return <span className="badge orange">Only {available} left</span>;
  return <span className="badge green">{available} in stock</span>;
}

export function ProductList({ onOrderPlaced }: { onOrderPlaced: (order: Order) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<number, number>>({}); // productId -> quantity
  const [error, setError] = useState("");

  const load = () => fetchProducts().then(setProducts).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  // Never let the cart go below 0 or above what is available.
  const change = (product: Product, delta: number) => {
    const next = Math.min(product.available, Math.max(0, (cart[product.id] ?? 0) + delta));
    setCart({ ...cart, [product.id]: next });
  };

  const lines = products.filter((p) => (cart[p.id] ?? 0) > 0);
  const totalPaise = lines.reduce((sum, p) => sum + p.pricePaise * cart[p.id], 0);

  const submit = async () => {
    setError("");
    try {
      const order = await placeOrder(lines.map((p) => ({ productId: p.id, quantity: cart[p.id] })));
      onOrderPlaced(order);
    } catch (e) {
      setError((e as Error).message);
      load(); // stock probably changed, show fresh numbers
    }
  };

  return (
    <>
      <h1 className="screen-title">Pick your snacks</h1>
      <div className="grid">
        {products.map((p) => (
          <div className={`product ${p.available === 0 ? "sold-out" : ""}`} key={p.id} data-testid="product">
            <StockBadge available={p.available} />
            <ProductIcon name={p.name} />
            <div className="product-name">{p.name}</div>
            <div className="product-price">{formatRupees(p.pricePaise)}</div>
            <div className="qty">
              <button aria-label={`Remove ${p.name}`} onClick={() => change(p, -1)}>−</button>
              <span className="qty-value">{cart[p.id] ?? 0}</span>
              <button aria-label={`Add ${p.name}`} onClick={() => change(p, 1)}>+</button>
            </div>
          </div>
        ))}
      </div>

      <div className="cart-bar">
        <div className="cart-total">Total: {formatRupees(totalPaise)}</div>
        <button className="primary" disabled={lines.length === 0} onClick={submit}>
          Place order
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}
