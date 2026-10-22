import { useEffect, useState } from "react";
import { fetchProducts, formatRupees, placeOrder, type Order, type Product } from "./api";

export function ProductList({ onOrderPlaced }: { onOrderPlaced: (order: Order) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<number, number>>({}); // productId -> quantity
  const [error, setError] = useState("");

  const load = () => fetchProducts().then(setProducts).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

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
    <div>
      <h1>Pickup Counter</h1>
      {products.map((p) => (
        <div className="row" key={p.id}>
          <div>
            {p.name} — {formatRupees(p.pricePaise)}
            <br />
            <small>{p.available} available</small>
          </div>
          <div className="qty">
            <button onClick={() => change(p, -1)}>−</button>
            <span>{cart[p.id] ?? 0}</span>
            <button onClick={() => change(p, 1)}>+</button>
          </div>
        </div>
      ))}
      <div className="total">Total: {formatRupees(totalPaise)}</div>
      <button disabled={lines.length === 0} onClick={submit}>
        Place order
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
