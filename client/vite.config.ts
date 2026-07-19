import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The client dev server proxies `/api/*` to the Express server so the browser
// can call the backend without CORS. `/api/health` -> server `/health`.
// Better Auth is mounted at `/api/auth/*` on the server, so that prefix must be
// forwarded untouched — the more specific rule is listed first.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api/auth": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
