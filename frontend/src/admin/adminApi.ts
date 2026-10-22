import { request, sendJson, type CashRequest } from "../api";

export type Role = "admin" | "staff";
export type User = { id: number; email: string; role: Role };

export type AdminProduct = {
  id: number;
  name: string;
  pricePaise: number;
  costPaise: number;
  stock: number;
  available: number;
  category: string;
  imageUrl: string | null;
  active: boolean;
};

export type Summary = {
  revenuePaise: number;
  costPaise: number;
  profitPaise: number;
  orders: number;
  units: number;
  cashCollectedPaise: number;
  cashByOperator: { operatorId: number; email: string; approvals: number; amountPaise: number }[];
};
export type DailyRow = { day: string; revenuePaise: number; profitPaise: number; orders: number };
export type CategoryRow = { category: string; units: number; revenuePaise: number };
export type TopProduct = { id: number; name: string; category: string; units: number; revenuePaise: number; profitPaise: number };
export type Range = { from: string; to: string };

// Auth: the server sets / clears an HttpOnly cookie; the page never sees the token.
export const me = () => request<User>("/auth/me");
export const login = (email: string, password: string) => request<User>("/auth/login", sendJson("POST", { email, password }));
export const logout = () => request<null>("/auth/logout", sendJson("POST"));

// Cash queue (staff and admin).
export const fetchCashRequests = () => request<CashRequest[]>("/admin/cash-requests");
export const approveCash = (id: string) => request<{ result: string }>(`/admin/orders/${id}/approve-cash`, sendJson("POST"));
export const rejectCash = (id: string) => request<{ result: string }>(`/admin/orders/${id}/reject-cash`, sendJson("POST"));

// Catalog (admin).
export const fetchAdminProducts = () => request<AdminProduct[]>("/admin/products");
export const createProduct = (body: unknown) => request<AdminProduct>("/admin/products", sendJson("POST", body));
export const updateProduct = (id: number, body: unknown) => request<AdminProduct>(`/admin/products/${id}`, sendJson("PATCH", body));

// Analytics (admin).
const q = (r: Range) => `from=${r.from}&to=${r.to}`;
export const fetchSummary = (r: Range) => request<Summary>(`/admin/analytics/summary?${q(r)}`);
export const fetchDaily = (r: Range) => request<DailyRow[]>(`/admin/analytics/daily?${q(r)}`);
export const fetchCategories = (r: Range) => request<CategoryRow[]>(`/admin/analytics/categories?${q(r)}`);
export const fetchTopProducts = (r: Range) => request<TopProduct[]>(`/admin/analytics/top-products?${q(r)}`);
export const dailyPdfUrl = (date: string) => `/api/admin/reports/daily-pdf?date=${date}`;
