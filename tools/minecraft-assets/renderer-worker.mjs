#!/usr/bin/env node
/**
 * Playwright renderer worker — run via Node.js (not Bun).
 * Reads config JSON from stdin, renders items with Playwright, writes PNGs.
 * Outputs progress as JSON lines to stdout:
 *   { type: "progress", i, total, rendered, failed }
 *   { type: "done", rendered, failed, renderedIds: [...] }
 *   { type: "error", message }
 */

import { createRequire } from "module";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const require = createRequire(import.meta.url);

let config;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  config = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch (e) {
  process.stdout.write(JSON.stringify({ type: "error", message: "Failed to parse config: " + e.message }) + "\n");
  process.exit(1);
}

const { baseUrl, VERSION, rendererJs, iconsDir, toRender } = config;

// Ensure icons dir exists
await mkdir(iconsDir, { recursive: true });

let playwright;
try {
  playwright = require(join(process.cwd(), "node_modules", "playwright"));
} catch (e) {
  process.stdout.write(JSON.stringify({ type: "error", message: "Cannot load playwright: " + e.message }) + "\n");
  process.exit(1);
}

const { chromium } = playwright;

const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-webgl",
    "--use-gl=angle",
    "--use-angle=default",
    "--ignore-gpu-blocklist",
  ],
});

const page = await browser.newPage();
await page.setViewportSize({ width: 256, height: 256 });
await page.setContent("<!DOCTYPE html><html><body></body></html>");
await page.addScriptTag({ content: rendererJs });

// Populate in-page model cache
await page.evaluate(async (version) => {
  await window.preloadModels(version);
}, VERSION);

let rendered = 0;
let failed = 0;
const renderedIds = [];

for (let i = 0; i < toRender.length; i++) {
  const item = toRender[i];
  const pngPath = join(iconsDir, `${item.id}.png`);

  // Skip already-rendered
  if (existsSync(pngPath)) {
    renderedIds.push(item.id);
    rendered++;
    process.stdout.write(JSON.stringify({ type: "progress", i: i + 1, total: toRender.length, rendered, failed }) + "\n");
    continue;
  }

  try {
    const dataUrl = await page.evaluate(
      async ({ modelPath, version, tints }) => {
        return window.renderToCanvas(modelPath, version, tints ?? undefined);
      },
      { modelPath: item.model, version: VERSION, tints: item.tints ?? null },
    );

    if (dataUrl) {
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      await writeFile(pngPath, Buffer.from(base64, "base64"));
      renderedIds.push(item.id);
      rendered++;
    } else {
      failed++;
    }
  } catch {
    failed++;
  }

  process.stdout.write(JSON.stringify({ type: "progress", i: i + 1, total: toRender.length, rendered, failed }) + "\n");
}

await browser.close();

process.stdout.write(JSON.stringify({ type: "done", rendered, failed, renderedIds }) + "\n");
