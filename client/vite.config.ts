import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The client dev server proxies `/api/*` to the Express server so the browser
// can call the backend without CORS. The generic `/api` rule strips the prefix
// (`/api/health` -> server `/health`). Routes the server registers *with* the
// `/api` prefix must be forwarded untouched instead, so each gets its own more
// specific rule listed first: `/api/auth/*` (Better Auth) and `/api/me`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api/auth": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/api/me": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/api/users": {
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
