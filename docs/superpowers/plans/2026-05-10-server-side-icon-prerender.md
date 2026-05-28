# Server-Side Vanilla Icon Pre-Rendering (Playwright) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-render all vanilla Minecraft item 3D icons server-side at asset-generation time, eliminating the client-side Three.js rendering delay in the editor Library.

**Architecture:** A `gen-icons.ts` Bun script starts a minimal local HTTP file server (textures + models + model bundle), uses `Bun.build` to bundle the existing Three.js renderer into a self-contained browser bundle with the local server URL injected, then launches Playwright Chromium headless to render each item with a `model` field to a 128×128 PNG. Rendered PNGs are saved under `data/mc-assets/{version}/textures/icons/` and items.json is updated to reference them as `texture: "icons/{id}"` (no `model` field) so the editor Library serves them instantly as flat `<img>` tags via the already-existing `GET /api/textures/:version/*` route. Custom items (Nexo/Oraxen) are unchanged — they stay client-side rendered.

**Tech Stack:** Playwright (Chromium headless), Bun.build API (bundles Three.js renderer from `editor/node_modules`), Bun built-in HTTP server, existing `mcModelRenderer.ts` reused without modification.

---

## File Structure

**Create:**
- `backend/scripts/renderer-browser.ts` — Thin two-line harness: imports `renderToCanvas` + `preloadModels` from `mcModelRenderer.ts` and assigns them to `window.*`. Bundled by `gen-icons.ts` at runtime via `Bun.build`.
- `backend/scripts/gen-icons.ts` — Main pre-render script: local file server, renderer bundle compilation, Playwright loop, PNG writing, items.json update.

**Modify:**
- `backend/src/routes/modelBundle.ts` line 82 — Add `export` to `buildVanillaBundle` so gen-icons.ts can call it directly without spawning the full backend.
- `backend/package.json` — Add `playwright` to devDependencies.

**No changes needed:**
- `backend/scripts/gen-items.ts` — still the first step; gen-icons runs after it.
- `editor/src/lib/mcModelRenderer.ts` — reused as-is via Bun bundle.
- `editor/src/features/canvas/Library.tsx` — items without `model` field already display as flat `<img>`, no change needed.
- All backend routes — `GET /api/textures/:version/*` already serves icons once the PNGs are in place.

---

### Task 1: Export buildVanillaBundle + install Playwright

**Files:**
- Modify: `backend/src/routes/modelBundle.ts:82`
- Modify: `backend/package.json`

- [ ] **Step 1: Export buildVanillaBundle**

In `backend/src/routes/modelBundle.ts`, line 82, change:
```typescript
async function buildVanillaBundle(version: string): Promise<Record<string, ResolvedModel>> {
```
to:
```typescript
export async function buildVanillaBundle(version: string): Promise<Record<string, ResolvedModel>> {
```

- [ ] **Step 2: Add playwright to devDependencies in backend/package.json**

```json
{
  "name": "artisan-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "drizzle-orm": "^0.31.0",
    "fflate": "^0.8.2",
    "hono": "^4.7.0",
    "postgres": "^3.4.4",
    "yaml": "^2.8.4"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "drizzle-kit": "^0.22.0",
    "playwright": "^1.52.0",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 3: Install and download Chromium**

Run from `backend/`:
```bash
bun install
```
```bash
bunx playwright install chromium --with-deps
```
Expected: Chromium downloaded to `~/.cache/ms-playwright/chromium-*/`. Takes 1-2 minutes.

- [ ] **Step 4: Verify backend tests still pass**

Run from `backend/`:
```bash
bun test
```
Expected: 105 pass, 1 fail (pre-existing invalid-version test — unrelated).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/modelBundle.ts backend/package.json backend/bun.lock
git commit -m "feat(backend): export buildVanillaBundle, add playwright devDep"
```

---

### Task 2: Create renderer-browser.ts

This is the browser-side harness that gets bundled by `Bun.build` and injected into the Playwright page. It re-exports the two public functions from `mcModelRenderer.ts` onto `window`, making them callable via `page.evaluate()`.

**Files:**
- Create: `backend/scripts/renderer-browser.ts`

- [ ] **Step 1: Create the file**

`backend/scripts/renderer-browser.ts`:
```typescript
import { renderToCanvas, preloadModels } from "../../editor/src/lib/mcModelRenderer";

declare global {
  interface Window {
    renderToCanvas: typeof renderToCanvas;
    preloadModels: typeof preloadModels;
  }
}

window.renderToCanvas = renderToCanvas;
window.preloadModels = preloadModels;
```

- [ ] **Step 2: Verify Bun can resolve the import chain**

Run from `backend/`:
```bash
bun build scripts/renderer-browser.ts --target=browser --outfile=/tmp/renderer-test.js 2>&1 | head -10
```
Expected: output is empty (no errors), `/tmp/renderer-test.js` created (~700 KB due to bundled Three.js).

If `three` module not found error: `three` lives in `editor/node_modules/`. Bun resolves it via the import chain starting from `editor/src/lib/mcModelRenderer.ts`, so it should find it. If not, add `"three": "^0.176.0"` to backend devDependencies and re-run `bun install`.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/renderer-browser.ts
git commit -m "feat(backend): renderer-browser.ts harness for Playwright bundle"
```

---

### Task 3: Create gen-icons.ts — file server + bundle compilation

Build the first half of gen-icons.ts: argument parsing, prerequisite checks, model bundle loading, local file server start, and renderer bundle compilation via `Bun.build`.

**Files:**
- Create: `backend/scripts/gen-icons.ts`

- [ ] **Step 1: Create gen-icons.ts**

`backend/scripts/gen-icons.ts`:
```typescript
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
```

- [ ] **Step 2: Smoke-test the server + bundle step**

Temporarily add `server.stop(); process.exit(0);` at the very end, then run:
```bash
bun backend/scripts/gen-icons.ts 1.21.11
```
Expected:
```
Found 750 items with 3D model paths.
Building model bundle…
  750 models resolved.
File server on http://localhost:XXXXX
Bundling Three.js renderer…
  Bundle: ~700 KB
```
Remove the temporary exit lines before continuing.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/gen-icons.ts
git commit -m "feat(backend): gen-icons — file server and renderer bundle step"
```

---

### Task 4: Complete gen-icons.ts — Playwright render loop + PNG write + items.json update

**Files:**
- Modify: `backend/scripts/gen-icons.ts` (append Playwright section)

- [ ] **Step 1: Append Playwright launch + render loop + update to gen-icons.ts**

Append after the `console.log(\`  Bundle:…\`)` line:
```typescript
// ── Playwright render loop ────────────────────────────────────────────────────────

const iconsDir = join(TEXTURES_DIR, "icons");
await mkdir(iconsDir, { recursive: true });

console.log(`Rendering ${toRender.length} items…`);

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-webgl", "--use-gl=swiftshader"],
});
const page = await browser.newPage();
await page.setViewportSize({ width: 128, height: 128 });
await page.setContent("<!DOCTYPE html><html><body></body></html>");
await page.addScriptTag({ content: rendererJs });

// Populate in-page model cache (one fetch for all models, then renders use cache)
await page.evaluate(async (version: string) => {
  await window.preloadModels(version);
}, VERSION);

let rendered = 0;
let failed = 0;
const renderedIds = new Set<string>();

for (let i = 0; i < toRender.length; i++) {
  const item = toRender[i]!;
  try {
    const dataUrl: string | null = await page.evaluate(
      async ({ modelPath, version, tints }) => {
        return window.renderToCanvas(
          modelPath,
          version,
          false,
          undefined,
          tints as Record<number, string> | undefined,
        );
      },
      { modelPath: item.model!, version: VERSION, tints: item.tints ?? null },
    );

    if (dataUrl) {
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      await writeFile(join(iconsDir, `${item.id}.png`), Buffer.from(base64, "base64"));
      renderedIds.add(item.id);
      rendered++;
    } else {
      failed++;
    }
  } catch {
    failed++;
  }
  process.stdout.write(`\r  ${i + 1}/${toRender.length}  (${rendered} ok, ${failed} failed)`);
}

await browser.close();
server.stop();
console.log(`\nDone. Rendered: ${rendered}, Failed: ${failed}`);

// ── Update items.json ────────────────────────────────────────────────────────────
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
```

- [ ] **Step 2: Run gen-icons.ts end-to-end**

```bash
bun backend/scripts/gen-icons.ts 1.21.11
```
Expected output (approximate):
```
Found 750 items with 3D model paths.
Building model bundle…
  750 models resolved.
File server on http://localhost:XXXXX
Bundling Three.js renderer…
  Bundle: ~700 KB
Rendering 750 items…
  750/750  (745 ok, 5 failed)
Done. Rendered: 745, Failed: 5
Updated .../data/items/1.21.11.json
  745 items now reference pre-rendered PNGs
  5 items still have model paths (client-side fallback)
```

(Exact numbers may vary; some failures are expected for items whose textures or geometry can't be resolved.)

- [ ] **Step 3: Verify PNG files were written**

```bash
ls backend/data/mc-assets/1.21.11/textures/icons/ | wc -l
```
Expected: ~745.

```bash
file "backend/data/mc-assets/1.21.11/textures/icons/dispenser.png"
```
Expected: `PNG image data, 128 x 128, 8-bit/color RGBA, non-interlaced`

- [ ] **Step 4: Verify items.json was updated**

```bash
bun -e "const i=JSON.parse(await Bun.file('backend/data/items/1.21.11.json').text()); const d=i.find(x=>x.id==='dispenser'); console.log(d)"
```
Expected: `{ id: 'dispenser', label: 'Dispenser', category: 'misc', texture: 'icons/dispenser' }` — no `model` field.

```bash
bun -e "const i=JSON.parse(await Bun.file('backend/data/items/1.21.11.json').text()); console.log(i.filter(x=>x.model).length)"
```
Expected: 5 or fewer (only items gen-icons couldn't render keep their `model` field for client-side fallback).

- [ ] **Step 5: Run all backend tests**

```bash
cd backend && bun test
```
Expected: 105 pass, 1 fail (pre-existing).

- [ ] **Step 6: Run all editor tests**

```bash
cd editor && npm test
```
Expected: 400 pass.

- [ ] **Step 7: Update CLAUDE.md commands section**

In `Artisan/CLAUDE.md`, under the Backend commands block, add after the gen-items.ts usage:

```markdown
```bash
# After gen-items.ts: pre-render 3D icons server-side (Playwright + Three.js)
bun backend/scripts/gen-icons.ts [version]   # requires gen-items.ts to have run first
```
```

Also update the test count table row for `models.test.ts` / scripts if counts changed.

- [ ] **Step 8: Commit**

```bash
git add backend/scripts/gen-icons.ts backend/data/items/1.21.11.json Artisan/CLAUDE.md
git commit -m "feat(backend): gen-icons Playwright pre-renderer, updates items.json with icon paths"
```

**Do NOT commit `backend/data/mc-assets/`** — generated assets are not source files. Verify `backend/data/mc-assets/` is in `.gitignore`.
