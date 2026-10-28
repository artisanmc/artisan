#!/usr/bin/env bun
/**
 * Usage: bun gen-icons.ts [version]
 * Requires gen-items.ts to have been run first for the same version.
 *
 * For each item with a `model` field in items/{version}.json:
 *   - Renders to a 128x128 PNG via Playwright + Three.js headless
 *   - Saves PNG to mc-assets/{version}/textures/icons/{id}.png
 *   - Replaces { texture, model } with { texture: "icons/{id}" } in items.json
 *
 * Note: Playwright rendering is delegated to renderer-worker.mjs (Node.js) because
 * Playwright's --remote-debugging-pipe transport doesn't work under Bun on Windows.
 */

import { join } from "path";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { assetsRoot } from "./lib/mcAssets";
import { buildVanillaBundle } from "./lib/modelBundle";

const VERSION = process.argv[2] ?? "1.21.11";
const ASSETS = assetsRoot(VERSION);
const ITEMS_PATH = join(import.meta.dir, "items", `${VERSION}.json`);

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

// Local file server
// Serves exactly the routes mcModelRenderer.ts fetches from:
//   /api/v1/model-bundle/:version → pre-built bundle JSON
//   /api/v1/textures/:version/*   → PNG files from mc-assets/textures/
//   /api/v1/models/:version/*     → model JSON files (fallback if not in bundle)

const TEXTURES_DIR = join(ASSETS, "textures");
const MODELS_DIR = join(ASSETS, "models");
const bundleJson = JSON.stringify(bundle);

const server = Bun.serve({
  port: 0, // OS picks a free port
  fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const cors = { "Access-Control-Allow-Origin": "*" };

    if (path === `/api/v1/model-bundle/${VERSION}`) {
      return new Response(bundleJson, {
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    const texPrefix = `/api/v1/textures/${VERSION}/`;
    if (path.startsWith(texPrefix)) {
      const rel = path.slice(texPrefix.length);
      const filePath = join(TEXTURES_DIR, `${rel}.png`);
      if (!existsSync(filePath)) return new Response(null, { status: 404 });
      return new Response(Bun.file(filePath), {
        headers: { "Content-Type": "image/png", ...cors },
      });
    }

    const modelPrefix = `/api/v1/models/${VERSION}/`;
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

// Bundle renderer (Three.js + mcModelRenderer) for browser injection
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

// Playwright render loop (via Node.js subprocess)
// Playwright's --remote-debugging-pipe transport doesn't work under Bun on Windows.
// We delegate the Playwright work to a Node.js worker script that communicates via
// stdin (config JSON) and stdout (JSON-line progress events).

const iconsDir = join(TEXTURES_DIR, "icons");
await mkdir(iconsDir, { recursive: true });

console.log(`Rendering ${toRender.length} items…`);

const workerConfig = JSON.stringify({
  baseUrl,
  VERSION,
  rendererJs,
  iconsDir,
  toRender,
});

const workerPath = join(import.meta.dir, "renderer-worker.mjs");
const workerProc = Bun.spawn(["node", workerPath], {
  stdin: new TextEncoder().encode(workerConfig),
  stdout: "pipe",
  stderr: "inherit",
  cwd: import.meta.dir,
});

let rendered = 0;
let failed = 0;
const renderedIds = new Set<string>();

// Read JSON-line progress events from worker stdout
const reader = workerProc.stdout.getReader();
const dec = new TextDecoder();
let buf = "";
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split("\n");
  buf = lines.pop()!; // keep incomplete last line
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as {
        type: string; i?: number; total?: number;
        rendered?: number; failed?: number;
        renderedIds?: string[]; message?: string;
      };
      if (ev.type === "progress") {
        rendered = ev.rendered!;
        failed = ev.failed!;
        process.stdout.write(`\r  ${ev.i}/${ev.total}  (${rendered} ok, ${failed} failed)`);
      } else if (ev.type === "done") {
        rendered = ev.rendered!;
        failed = ev.failed!;
        for (const id of ev.renderedIds!) renderedIds.add(id);
      } else if (ev.type === "error") {
        console.error("\nRenderer worker error:", ev.message);
      }
    } catch {
      // ignore malformed lines
    }
  }
}

const exitCode = await workerProc.exited;
server.stop();
console.log(`\nDone. Rendered: ${rendered}, Failed: ${failed}`);
if (exitCode !== 0) {
  console.error(`Worker exited with code ${exitCode}`);
  process.exit(exitCode);
}

// Update items.json
// Rendered items: drop `model` and `tints`, set texture to "icons/{id}".
// Unrendered items: keep as-is (client-side fallback still works).

const updated: Item[] = items.map(item => {
  if (!renderedIds.has(item.id)) return item;
  const { model: _m, tints: _t, ...rest } = item;
  return { ...rest, texture: `icons/${item.id}` };
});

await writeFile(ITEMS_PATH, JSON.stringify(updated, null, 2));

const stillWithModel = updated.filter(i => i.model).length;
console.log(`Updated ${ITEMS_PATH}`);
console.log(`  ${renderedIds.size} items now reference pre-rendered PNGs`);
if (stillWithModel > 0) {
  console.log(`  ${stillWithModel} items still have model paths (client-side fallback)`);
}
