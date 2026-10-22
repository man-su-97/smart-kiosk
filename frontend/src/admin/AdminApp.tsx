import { useEffect, useState } from "react";
import { logout, me, type User } from "./adminApi";
import { LoginPage } from "./LoginPage";
import { CashQueue } from "./CashQueue";
import { Dashboard } from "./Dashboard";
import { Products } from "./Products";
import { Reports } from "./Reports";
import { TeamAndDuty } from "./TeamAndDuty";

type Tab = "dashboard" | "products" | "team" | "cash" | "reports";

// Which tabs each role sees. This only hides buttons; the server checks the role on every call.
const TABS: { id: Tab; label: string; roles: User["role"][] }[] = [
  { id: "dashboard", label: "Dashboard", roles: ["admin"] },
  { id: "products", label: "Products", roles: ["admin"] },
  { id: "team", label: "Staff & duty", roles: ["admin"] },
  { id: "cash", label: "Cash queue", roles: ["admin", "staff"] },
  { id: "reports", label: "Reports", roles: ["admin"] },
];

export function AdminApp() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>("cash");

  // Already logged in? (The session cookie is sent automatically.)
  useEffect(() => {
    me()
      .then(signedIn)
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  function signedIn(u: User) {
    setUser(u);
    setTab(u.role === "admin" ? "dashboard" : "cash");
  }

  async function signOut() {
    await logout().catch(() => {});
    setUser(null);
  }

  if (checking) return <p className="p-6 text-muted">Loading…</p>;
  if (!user) return <LoginPage onLogin={signedIn} />;

  const tabs = TABS.filter((t) => t.roles.includes(user.role));
  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-xl font-extrabold">
          <span className="grid size-9 place-items-center rounded-xl bg-brand">🥨</span> Snack Kiosk portal
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span data-testid="who">
            {user.email} · <strong className="capitalize">{user.role}</strong>
          </span>
          <button className="btn btn-ghost px-3 py-2" onClick={signOut}>Log out</button>
        </div>
      </header>

      <nav className="mb-6 flex flex-wrap gap-1.5 rounded-[18px] bg-soft p-1.5" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`btn px-4 py-2.5 ${tab === t.id ? "bg-white shadow-[0_4px_12px_rgba(31,33,64,0.12)]" : "bg-transparent"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "dashboard" && <Dashboard />}
      {tab === "products" && <Products />}
      {tab === "team" && <TeamAndDuty />}
      {tab === "cash" && <CashQueue />}
      {tab === "reports" && <Reports />}
    </div>
  );
}
