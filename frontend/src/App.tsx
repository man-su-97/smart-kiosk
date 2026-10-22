import { useState } from "react";
import type { Order } from "./api";
import { ProductList } from "./ProductList";
import { PaymentScreen } from "./PaymentScreen";

// The kiosk frame stays the same; only what is inside changes.
export function App() {
  const [order, setOrder] = useState<Order | null>(null);

  return (
    <div className="kiosk">
      <header className="kiosk-header">🥨 Snack Kiosk</header>
      <main className="kiosk-screen">
        {order ? (
          <PaymentScreen firstOrder={order} onDone={() => setOrder(null)} />
        ) : (
          <ProductList onOrderPlaced={setOrder} />
        )}
      </main>
    </div>
  );
}
