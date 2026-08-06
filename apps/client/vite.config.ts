import path from "node:path";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

// Значения Supabase больше не захардкожены здесь: они приходят из .env
// (локально) или из переменных окружения сборки (Coolify) — см. .env.example.

export default defineConfig(({ command }) => ({
  server: { host: "::", port: 8080 },
  // Vite uses PostCSS in dev and Lightning CSS only at build; running Lightning
  // CSS in both keeps the dev preview identical to the built output.
  css: { transformer: "lightningcss" },
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(__dirname, "src") }],
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
    ignoreOutdatedRequests: true,
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      server: { entry: "server" },
    }),
    // Nitro packages the SSR app as a standalone node-server bundle
    // (.output/server/index.mjs) — то, что запускает Dockerfile.
    ...(command === "build" ? [nitro({ preset: "node-server" })] : []),
    viteReact(),
  ],
}));
