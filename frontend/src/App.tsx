import { useState } from "react";
import type { CartLine, Order } from "./api";
import { ProductList } from "./ProductList";
import { PaymentScreen } from "./PaymentScreen";

// The kiosk frame stays the same; only what is inside changes.
export function App() {
  const [placed, setPlaced] = useState<{ order: Order; lines: CartLine[] } | null>(null);

  return (
    <div className="kiosk">
      <header className="kiosk-header">
        <span className="logo">🥨</span> Snack Kiosk
      </header>
      <main className="kiosk-screen">
        {placed ? (
          <PaymentScreen firstOrder={placed.order} lines={placed.lines} onDone={() => setPlaced(null)} />
        ) : (
          <ProductList onOrderPlaced={(order, lines) => setPlaced({ order, lines })} />
        )}
      </main>
    </div>
  );
}
