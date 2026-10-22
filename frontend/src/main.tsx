import { createRoot } from "react-dom/client";
import { App } from "./App";
import { MockPayPage } from "./MockPayPage";
import { AdminPage } from "./AdminPage";
import "./styles.css";

// Three pages, picked by URL path. Small enough that a router library is not needed.
//   /          the kiosk screen
//   /mock-pay  the "UPI app" page a phone opens after scanning the QR (demo)
//   /admin     the operator's cash approval dashboard
function Page() {
  if (window.location.pathname === "/mock-pay") return <MockPayPage />;
  if (window.location.pathname === "/admin") return <AdminPage />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(<Page />);
