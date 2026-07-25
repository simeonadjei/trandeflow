import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT and BASE_PATH are injected by Replit workflows.
// Outside Replit (e.g. Render static builds) always use "/" so asset paths are correct.
const rawPort = process.env.PORT ?? "3000";
const port = Number(rawPort);
const basePath = process.env.REPL_ID ? (process.env.BASE_PATH ?? "/") : "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    // Replit-only plugins — skip entirely outside Replit environment
    ...(process.env.REPL_ID !== undefined
      ? [
          runtimeErrorOverlay(),
          ...(process.env.NODE_ENV !== "production"
            ? [
                await import("@replit/vite-plugin-cartographer").then((m) =>
                  m.cartographer({
                    root: path.resolve(import.meta.dirname, ".."),
                  }),
                ),
                await import("@replit/vite-plugin-dev-banner").then((m) =>
                  m.devBanner(),
                ),
              ]
            : []),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  optimizeDeps: {
    include: ["recharts", "victory-vendor", "react-smooth"],
  },
  build: {
    // esnext target avoids down-compilation that introduces TDZ in circular ESM deps
    target: "esnext",
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        // Group recharts + ALL its transitive deps (victory-vendor, react-smooth,
        // recharts-scale, d3-*) into one chunk so there are no cross-chunk
        // circular-import TDZ crashes ("Cannot access 'X' before initialization").
        manualChunks(id) {
          if (
            id.includes("recharts") ||
            id.includes("victory-vendor") ||
            id.includes("react-smooth") ||
            id.includes("recharts-scale") ||
            id.includes("/d3-")
          ) {
            return "recharts-vendor";
          }
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
