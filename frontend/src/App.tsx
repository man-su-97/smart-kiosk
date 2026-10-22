import { useState } from "react";
import type { Order } from "./api";
import { ProductList } from "./ProductList";
import { PaymentScreen } from "./PaymentScreen";

export function App() {
  const [order, setOrder] = useState<Order | null>(null);

  return order ? (
    <PaymentScreen firstOrder={order} onDone={() => setOrder(null)} />
  ) : (
    <ProductList onOrderPlaced={setOrder} />
  );
}
