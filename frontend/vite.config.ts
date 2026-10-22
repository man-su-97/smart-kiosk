import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser calls /api/..., Vite forwards it to the backend (no CORS needed).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_TARGET ?? "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
