export type Product = {
  id: number;
  name: string;
  pricePaise: number;
  stock: number;
  available: number;
  category: string;
  imageUrl: string | null;
};

export type Order = {
  id: string;
  status: "pending" | "pending_cash_approval" | "paid" | "expired" | "cancelled" | "needs_review" | "claimed";
  totalPaise: number;
  expiresInSeconds: number;
};

// What the customer put in the cart (kept in the browser; the server recalculates the real total).
export type CartLine = { product: Product; quantity: number };

// Money is whole paise everywhere; only convert to rupees when drawing the screen.
export const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export type CashRequest = {
  id: string;
  totalPaise: number;
  expiresInSeconds: number;
  items: { name: string; quantity: number }[];
};

// Same-origin requests send the session cookie automatically, so the admin calls need no token.
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, options);
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new ApiError(res.status, data?.message ?? "Request failed");
  return data;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const sendJson = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const fetchProducts = () => request<Product[]>("/products");

export const fetchOrder = (id: string) => request<Order>(`/orders/${id}`);

export const placeOrder = (items: { productId: number; quantity: number }[]) =>
  request<Order>("/orders", sendJson("POST", { items }));

// Customer chose "Pay with cash": the order waits for staff.
export const requestCash = (orderId: string) => request<Order>(`/orders/${orderId}/cash-request`, sendJson("POST"));

// Mock UPI (demo): what the phone page and the "Simulate" button call.
export const mockUpiPay = (orderId: string) =>
  request<{ result: string }>("/payments/mock-success", sendJson("POST", { orderId }));
