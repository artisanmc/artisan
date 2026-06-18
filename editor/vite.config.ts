import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": srcDir,
      // @artisan/* are unbuilt TS-source workspace packages — alias them to
      // source so Vite dev (which won't transform .ts inside node_modules) and
      // build both resolve them. P1c publishes built JS and drops these aliases.
      "@artisan/editor-sdk": fileURLToPath(new URL("./packages/editor-sdk/src/index.ts", import.meta.url)),
      "@artisan/quests-editor": fileURLToPath(new URL("./packages/quests-editor/src/index.ts", import.meta.url)),
    },
  },
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
});
