#!/usr/bin/env bun
/**
 * Usage: bun backend/scripts/gen-icons.ts [version]
 * Requires gen-items.ts to have been run first for the same version.
 *
 * For each item with a `model` field in items/{version}.json:
 *   - Renders to a 128x128 PNG via Playwright + Three.js headless
 *   - Saves PNG to data/mc-assets/{version}/textures/icons/{id}.png
 *   - Replaces { texture, model } with { texture: "icons/{id}" } in items.json
 */

import { chromium } from "playwright";
import { join } from "path";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { assetsRoot } from "../src/lib/mcAssets";
import { buildVanillaBundle } from "../src/routes/modelBundle";

const VERSION = process.argv[2] ?? "1.21.11";
const ASSETS = assetsRoot(VERSION);
const ITEMS_PATH = join(import.meta.dir, "..", "data", "items", `${VERSION}.json`);

if (!existsSync(join(ASSETS, ".done"))) {
  console.error(`Assets for ${VERSION} not downloaded. Run gen-items.ts first.`);
  process.exit(1);
}
if (!existsSync(ITEMS_PATH)) {
  console.error(`items/${VERSION}.json not found. Run gen-items.ts first.`);
  process.exit(1);
}

type Item = {
  id: string; label: string; category: string; texture: string;
  model?: string; tints?: Record<number, string>;
};

const items: Item[] = JSON.parse(await readFile(ITEMS_PATH, "utf8"));
const toRender = items.filter(i => i.model);

if (toRender.length === 0) {
  console.log("No items with model paths — items.json is already up to date.");
  process.exit(0);
}

console.log(`Found ${toRender.length} items with 3D model paths.`);

// Build model bundle (same data the /api/model-bundle route would serve)
console.log("Building model bundle…");
const bundle = await buildVanillaBundle(VERSION);
console.log(`  ${Object.keys(bundle).length} models resolved.`);

// ── Local file server ────────────────────────────────────────────────────────────
// Serves exactly the routes mcModelRenderer.ts fetches from:
//   /api/model-bundle/:version   → pre-built bundle JSON
//   /api/textures/:version/*     → PNG files from mc-assets/textures/
//   /api/models/:version/*       → model JSON files (fallback if not in bundle)

const TEXTURES_DIR = join(ASSETS, "textures");
const MODELS_DIR = join(ASSETS, "models");
const bundleJson = JSON.stringify(bundle);

const server = Bun.serve({
  port: 0, // OS picks a free port
  fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const cors = { "Access-Control-Allow-Origin": "*" };

    if (path === `/api/model-bundle/${VERSION}`) {
      return new Response(bundleJson, {
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    const texPrefix = `/api/textures/${VERSION}/`;
    if (path.startsWith(texPrefix)) {
      const rel = path.slice(texPrefix.length);
      const filePath = join(TEXTURES_DIR, `${rel}.png`);
      if (!existsSync(filePath)) return new Response(null, { status: 404 });
      return new Response(Bun.file(filePath), {
        headers: { "Content-Type": "image/png", ...cors },
      });
    }

    const modelPrefix = `/api/models/${VERSION}/`;
    if (path.startsWith(modelPrefix)) {
      const rel = path.slice(modelPrefix.length);
      const filePath = join(MODELS_DIR, `${rel}.json`);
      if (!existsSync(filePath)) return new Response(null, { status: 404 });
      return new Response(Bun.file(filePath), {
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    return new Response(null, { status: 404 });
  },
});

const baseUrl = `http://localhost:${server.port}`;
console.log(`File server on ${baseUrl}`);

// ── Bundle renderer (Three.js + mcModelRenderer) for browser injection ────────────
// Bun.build bundles editor/src/lib/mcModelRenderer.ts + three into a single IIFE.
// define replaces import.meta.env.VITE_API_URL with our local server URL.

console.log("Bundling Three.js renderer…");
const buildResult = await Bun.build({
  entrypoints: [join(import.meta.dir, "renderer-browser.ts")],
  target: "browser",
  format: "iife",
  define: { "import.meta.env.VITE_API_URL": JSON.stringify(baseUrl) },
});

if (!buildResult.success) {
  console.error("Renderer bundle failed:");
  for (const msg of buildResult.logs) console.error(msg);
  server.stop();
  process.exit(1);
}

const rendererJs = await buildResult.outputs[0].text();
console.log(`  Bundle: ${(rendererJs.length / 1024).toFixed(0)} KB`);
