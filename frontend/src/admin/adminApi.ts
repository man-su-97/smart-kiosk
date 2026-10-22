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
  cashByOperator: { operatorId: number; email: string; name: string; approvals: number; amountPaise: number }[];
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

// Smart image upload: the server crops every picture to the same 512 x 512 square.
export type StoredImage = { imageUrl: string; original: { width: number; height: number }; cropped: boolean };
export const uploadImage = (file: File) =>
  request<StoredImage>("/admin/images", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
export const importImage = (url: string) => request<StoredImage>("/admin/images/import", sendJson("POST", { url }));

// People, kiosks and the duty roster (admin), and "my duty" (staff).
export type Person = { id: number; name: string | null; email: string; role: Role; active: boolean };
export type Kiosk = { id: number; code: string; name: string; location: string; active: boolean; onDutyName: string | null };
export type Shift = {
  id: number;
  kioskId: number;
  kioskCode: string;
  kioskName: string;
  userId: number;
  userName: string;
  date: string;
  startTime: string;
  endTime: string;
  note: string;
};
export const fetchPeople = () => request<Person[]>("/admin/users");
export const addPerson = (body: { name: string; email: string; password: string; role: Role }) =>
  request<Person>("/admin/users", sendJson("POST", body));
export const updatePerson = (id: number, body: { name?: string; active?: boolean }) =>
  request<Person>(`/admin/users/${id}`, sendJson("PATCH", body));
export const fetchKiosks = () => request<Kiosk[]>("/admin/kiosks");
export const addKiosk = (body: { code: string; name: string; location: string }) => request<Kiosk>("/admin/kiosks", sendJson("POST", body));
export const fetchShifts = (r: Range) => request<Shift[]>(`/admin/shifts?${q(r)}`);
export const addShift = (body: { kioskId: number; userId: number; date: string; startTime: string; endTime: string; note: string }) =>
  request<{ id: number }>("/admin/shifts", sendJson("POST", body));
export const deleteShift = (id: number) => request<null>(`/admin/shifts/${id}`, { method: "DELETE" });
export const fetchMyShifts = () => request<Shift[]>("/staff/my-shifts");

// Money problems for a person to sort out (paid twice, needs review).
export type AttentionItem = {
  kind: "paid_twice" | "needs_review";
  orderId: string;
  billNo: string;
  amountPaise: number;
  detail: string;
  person: string | null;
  kiosk: string | null;
  at: string;
};
export const fetchAttention = () => request<AttentionItem[]>("/admin/attention");
