import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { MockPayPage } from "./MockPayPage";
import "./styles.css";

// The portal (with its chart library) is only downloaded when someone opens /admin,
// so the kiosk screen stays small and fast.
const AdminApp = lazy(() => import("./admin/AdminApp").then((m) => ({ default: m.AdminApp })));

// Three pages, picked by URL path. Small enough that a router library is not needed.
//   /          the kiosk screen
//   /mock-pay  the "UPI app" page a phone opens after scanning the QR (demo)
//   /admin     the staff / admin portal (login, cash queue, products, dashboard, reports)
function Page() {
  if (window.location.pathname === "/mock-pay") return <MockPayPage />;
  if (window.location.pathname === "/admin") {
    return (
      <Suspense fallback={<p className="p-6 text-muted">Loading…</p>}>
        <AdminApp />
      </Suspense>
    );
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(<Page />);
