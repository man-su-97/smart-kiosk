import { useState } from "react";
import type { CartLine, Order } from "./api";
import { ProductList } from "./ProductList";
import { PaymentScreen } from "./PaymentScreen";

// The kiosk frame stays the same; only what is inside changes.
export function App() {
  const [placed, setPlaced] = useState<{ order: Order; lines: CartLine[] } | null>(null);

  return (
    <div className="mx-auto min-h-screen max-w-[1040px]">
      <header className="flex items-center gap-2.5 px-6 py-[18px] text-[22px] font-extrabold tracking-tight">
        <span className="grid size-10 place-items-center rounded-xl bg-brand text-[22px]">🥨</span> Snack Kiosk
      </header>
      <main className="px-6 pb-36">
        {placed ? (
          <PaymentScreen firstOrder={placed.order} lines={placed.lines} onDone={() => setPlaced(null)} />
        ) : (
          <ProductList onOrderPlaced={(order, lines) => setPlaced({ order, lines })} />
        )}
      </main>
    </div>
  );
}
