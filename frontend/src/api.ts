export type Product = { id: number; name: string; pricePaise: number; stock: number; available: number };

export type Order = {
  id: string;
  status: "pending" | "paid" | "expired" | "needs_review" | "claimed";
  totalPaise: number;
  expiresInSeconds: number;
};

// What the customer put in the cart (kept in the browser; the server recalculates the real total).
export type CartLine = { product: Product; quantity: number };

// Money is whole paise everywhere; only convert to rupees when drawing the screen.
export const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchProducts = () => request<Product[]>("/products");

export const fetchOrder = (id: string) => request<Order>(`/orders/${id}`);

export const placeOrder = (items: { productId: number; quantity: number }[]) =>
  request<Order>("/orders", postJson({ items }));

// Demo cash acceptor: pretends the customer inserted the money.
export const payCash = (orderId: string) => request<{ result: string }>("/payments/cash", postJson({ orderId }));
