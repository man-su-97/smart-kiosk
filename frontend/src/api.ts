export type Product = { id: number; name: string; pricePaise: number; stock: number; available: number };

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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, options);
  // A proxy error (API down or restarting) has no JSON body; show a plain message, not a parse error.
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

const postJson = (body?: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const fetchProducts = () => request<Product[]>("/products");

export const fetchOrder = (id: string) => request<Order>(`/orders/${id}`);

export const placeOrder = (items: { productId: number; quantity: number }[]) =>
  request<Order>("/orders", postJson({ items }));

// Customer chose "Pay with cash": the order waits for the operator.
export const requestCash = (orderId: string) => request<Order>(`/orders/${orderId}/cash-request`, postJson());

// Mock UPI (demo): what the phone page and the "Simulate" button call.
export const mockUpiPay = (orderId: string) =>
  request<{ result: string }>("/payments/mock-success", postJson({ orderId }));

// Operator (/admin) calls. The token is the operator's password.
const admin = (token: string) => ({ "X-Admin-Token": token });
export const fetchCashRequests = (token: string) =>
  request<CashRequest[]>("/admin/cash-requests", { headers: admin(token) });
export const approveCash = (token: string, id: string) =>
  request<{ result: string }>(`/admin/orders/${id}/approve-cash`, postJson(undefined, admin(token)));
export const rejectCash = (token: string, id: string) =>
  request<{ result: string }>(`/admin/orders/${id}/reject-cash`, postJson(undefined, admin(token)));
