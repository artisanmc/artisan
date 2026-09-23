import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createWikiMiddleware } from "./scripts/wiki-middleware.mjs";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    react(),
    tailwindcss(),
    {
      name: "artisan-wiki",
      configureServer(server) {
        server.middlewares.use(
          createWikiMiddleware(fileURLToPath(new URL("../docs-site/dist", import.meta.url))),
        );
      },
      configurePreviewServer(server) {
        server.middlewares.use(
          createWikiMiddleware(fileURLToPath(new URL("./dist/wiki", import.meta.url))),
        );
      },
    },
  ],
  resolve: {
    alias: {
      "@": srcDir,
      // @artisan/* are unbuilt TS-source workspace packages — alias them to
      // source so Vite dev (which won't transform .ts inside node_modules) and
      // build both resolve them. P1c publishes built JS and drops these aliases.
      "@artisan/editor-sdk": fileURLToPath(
        new URL("./packages/editor-sdk/src/index.ts", import.meta.url),
      ),
      "@artisan/quests-editor": fileURLToPath(
        new URL("./packages/quests-editor/src/index.ts", import.meta.url),
      ),
      "@artisan/boutique-editor": fileURLToPath(
        new URL("./packages/boutique-editor/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
});
