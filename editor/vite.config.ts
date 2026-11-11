import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { type PluginOption, defineConfig } from "vite";
import { createWikiMiddleware } from "./scripts/wiki-middleware.mjs";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const hubUrl = process.env.ARTISAN_HUB_URL ?? "http://localhost:8765";

/** `--mode site`: artisanmc.net, the landing page alone (src/site) plus the wiki. */
const site: PluginOption = {
  name: "artisan-site",
  transformIndexHtml: {
    order: "pre",
    handler: (html) => html.replace("/src/main.tsx", "/src/site/main.tsx"),
  },
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
};

export default defineConfig(({ mode }) => ({
  plugins: [TanStackRouterVite(), react(), tailwindcss(), mode === "site" && site],
  resolve: {
    alias: {
      "@": srcDir,
      // @artisan/* are unbuilt TS-source workspace packages — alias them to
      // source so Vite dev (which won't transform .ts inside node_modules) and
      // build both resolve them. P1c publishes built JS and drops these aliases.
      "@artisan/editor-sdk": fileURLToPath(
        new URL("./packages/editor-sdk/src/index.ts", import.meta.url),
      ),
      "@artisan/boutique-editor": fileURLToPath(
        new URL("./packages/boutique-editor/src/index.ts", import.meta.url),
      ),
    },
  },
  // The editor ships inside the plugin jar (plugin/hub, `-PwithEditor`).
  build: { outDir: mode === "site" ? "dist" : "dist-self-hosted" },
  server: {
    // The shared conformance vectors (testdata/core-actions.json is the table of
    // core actions the editor imports) live beside the editor, at the repo root.
    fs: { allow: [".", "../testdata"] },
    // The editor talks to the plugin's hub on the same origin: proxy it in dev.
    proxy: {
      "/api": hubUrl,
      "/ws": { target: hubUrl, ws: true },
    },
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
}));
