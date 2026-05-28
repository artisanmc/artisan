# Three.js Browser-Side Item Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace server-side software rasterizer with browser-side Three.js rendering so the editor Library shows Minecraft items exactly as they appear in the inventory GUI.

**Architecture:** Backend exposes model JSON routes; `gen-items.ts` outputs a `model` path for 3D items instead of pre-rendering icons; the browser fetches the model JSON chain, builds Three.js BufferGeometry, applies `display.gui` transform, and renders to an offscreen 128×128 canvas.

**Tech Stack:** Three.js (browser), Bun + Hono (backend model routes), Vitest (editor unit tests), Bun test (backend tests).

---

## File Map

**Created:**
- `backend/src/routes/models.ts` — Hono router: GET /api/models/:version/* and GET /api/models/custom/:serverKeyId/*
- `backend/src/routes/models.test.ts` — backend tests for model routes
- `editor/src/lib/mcModelRenderer.ts` — Three.js fetch→resolve→render pipeline
- `editor/src/lib/mcModelRenderer.test.ts` — unit tests (mocked fetch, no WebGL)

**Modified:**
- `backend/src/app.ts` — register modelsRouter
- `backend/scripts/gen-items.ts` — remove icon rendering, output `model?` field
- `backend/src/ws/hub.ts` — remove `renderCustomIcons` call + import
- `editor/src/lib/packApi.ts` — add `model?: string` to `LibraryItem`
- `editor/src/features/canvas/Library.tsx` — update `ItemTile` for lazy canvas rendering

**Deleted:**
- `backend/src/lib/customItemRenderer.ts`
- `backend/src/lib/customItemRenderer.test.ts`
- `backend/src/lib/iconRenderer.ts`

---

## Task 1: Backend model JSON routes

**Files:**
- Create: `backend/src/routes/models.ts`
- Create: `backend/src/routes/models.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/src/routes/models.test.ts`:

```typescript
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { app } from "../app";

const VER = "test_models_" + Date.now();

describe("GET /api/models/:version/*", () => {
  const tmpDir = join(import.meta.dir, `../../data/mc-assets/${VER}`);

  beforeEach(() => {
    mkdirSync(join(tmpDir, "models/block"), { recursive: true });
    writeFileSync(
      join(tmpDir, "models/block/stone.json"),
      JSON.stringify({ parent: "block/cube_all", textures: { all: "block/stone" } }),
    );
    mock.module("../lib/mcAssets", () => ({
      assetsDone: () => true,
      ensureAssets: () => Promise.resolve(),
      textureFilePath: () => null,
      assetsRoot: () => tmpDir,
    }));
  });

  afterEach(() => {
    mock.restore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("serves model JSON by version and path", async () => {
    const res = await app.request(`/api/models/${VER}/block/stone`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = (await res.json()) as { parent: string };
    expect(body.parent).toBe("block/cube_all");
  });

  test("returns 404 for missing model", async () => {
    const res = await app.request(`/api/models/${VER}/block/doesnt_exist`);
    expect(res.status).toBe(404);
  });

  test("returns 404 for path traversal", async () => {
    const res = await app.request(`/api/models/${VER}/../../evil`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/models/custom/:serverKeyId/*", () => {
  const SRV = "srv_model_test_" + Date.now();
  const cacheDir = join(import.meta.dir, `../../data/custom-items/${SRV}`);

  beforeEach(() => {
    mkdirSync(join(cacheDir, "models/nexo"), { recursive: true });
    writeFileSync(
      join(cacheDir, "models/nexo/forest_sword.json"),
      JSON.stringify({ parent: "minecraft:item/handheld", textures: { layer0: "nexo:item/forest_sword" } }),
    );
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  test("serves custom model JSON", async () => {
    const res = await app.request(`/api/models/custom/${SRV}/nexo/forest_sword`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { parent: string };
    expect(body.parent).toBe("minecraft:item/handheld");
  });

  test("returns 404 for missing custom model", async () => {
    const res = await app.request(`/api/models/custom/${SRV}/nexo/doesnt_exist`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend && bun test src/routes/models.test.ts
```
Expected: fails — route doesn't exist yet.

- [ ] **Step 3: Create `backend/src/routes/models.ts`**

```typescript
import { Hono } from "hono";
import { existsSync } from "fs";
import { join, resolve, sep } from "path";
import { assetsRoot, assetsDone, ensureAssets } from "../lib/mcAssets";
import { customItemsCacheDir } from "../lib/customItems";

const router = new Hono();

router.get("/custom/:serverKeyId/*", async (c) => {
  const serverKeyId = c.req.param("serverKeyId");
  const prefix = `/custom/${serverKeyId}/`;
  const rest = c.req.path.includes(prefix) ? c.req.path.split(prefix)[1] : "";
  if (!rest) return c.newResponse(null, 404);

  const baseDir = resolve(customItemsCacheDir(serverKeyId), "models");
  const filePath = resolve(join(baseDir, rest + ".json"));
  if (!filePath.startsWith(baseDir + sep)) return c.newResponse(null, 404);
  if (!existsSync(filePath)) return c.newResponse(null, 404);

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
  });
});

router.get("/:version/*", async (c) => {
  const version = c.req.param("version");
  const prefix = `/${version}/`;
  const rest = c.req.path.includes(prefix) ? c.req.path.split(prefix)[1] : "";
  if (!rest) return c.newResponse(null, 404);

  if (!assetsDone(version)) {
    ensureAssets(version).catch((err) =>
      console.error(`[mc-assets] Download failed for ${version}:`, err),
    );
    return c.newResponse(null, 404);
  }

  const baseDir = resolve(assetsRoot(version), "models");
  const filePath = resolve(join(baseDir, rest + ".json"));
  if (!filePath.startsWith(baseDir + sep)) return c.newResponse(null, 404);
  if (!existsSync(filePath)) return c.newResponse(null, 404);

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
  });
});

export { router as modelsRouter };
```

- [ ] **Step 4: Register in `backend/src/app.ts`**

After `import { texturesRouter }` add:
```typescript
import { modelsRouter } from "./routes/models";
```
After `app.route("/api/textures", texturesRouter)` add:
```typescript
app.route("/api/models", modelsRouter);
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd backend && bun test src/routes/models.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 6: Full backend regression check**

```bash
cd backend && bun test
```
Expected: all existing tests pass (was ~103).

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/models.ts backend/src/routes/models.test.ts backend/src/app.ts
git commit -m "feat(backend): add model JSON routes for vanilla and custom items"
```

---

## Task 2: Simplify gen-items.ts + update LibraryItem type

**Files:**
- Modify: `backend/scripts/gen-items.ts`
- Modify: `editor/src/lib/packApi.ts`

The goal: each item outputs `{ id, label, category, texture, model? }` where `model` is the model path if the item has block geometry (elements). No icon files are written.

- [ ] **Step 1: Update `LibraryItem` in `editor/src/lib/packApi.ts`**

Change:
```typescript
export interface LibraryItem {
  id: string;
  label: string;
  category: string;
  texture: string;
}
```
To:
```typescript
export interface LibraryItem {
  id: string;
  label: string;
  category: string;
  texture: string;
  model?: string;
}
```

- [ ] **Step 2: Rewrite `backend/scripts/gen-items.ts`**

Replace the entire file with the simplified version below. Key changes:
- Remove `PNG`, `readFileSync`, `renderIsometricIcon`, `renderFromElements`, `GuiDisplay` imports
- Remove `ICONS_DIR`, `mkdir(ICONS_DIR)`, skull infrastructure, cube renderer, display resolver
- `resolveItem` now returns `{ texture: string; model?: string }` — no file I/O
- Keep `resolveTextures`, `resolveElements`, `extractModelRef`, `pickFlat`, `resolveVar`, `readModel`, `categorize`, `toLabel`

```typescript
#!/usr/bin/env bun
/**
 * Usage: bun backend/scripts/gen-items.ts [version]
 * Requires MC assets to be downloaded first.
 *
 * For each item outputs { id, label, category, texture, model? }:
 *   - texture: flat sprite path (item/sword) — used for flat items and as fallback
 *   - model: model path if the item has 3D block elements — browser renders with Three.js
 */

import { join } from "path";
import { existsSync } from "fs";
import { readFile, readdir, writeFile } from "fs/promises";
import { assetsRoot } from "../src/lib/mcAssets";

const VERSION = process.argv[2] ?? "1.21.4";
const ASSETS = assetsRoot(VERSION);
const OUT_PATH = join(import.meta.dir, "..", "data", "items", `${VERSION}.json`);

if (!existsSync(join(ASSETS, ".done"))) {
  console.error(`Assets for ${VERSION} not downloaded yet.`);
  process.exit(1);
}

const itemsDir = join(ASSETS, "items");
const modelsDir = join(ASSETS, "models");

const modelCache = new Map<string, Record<string, unknown> | null>();

async function readModel(path: string): Promise<Record<string, unknown> | null> {
  if (modelCache.has(path)) return modelCache.get(path)!;
  const filePath = join(modelsDir, path + ".json");
  if (!existsSync(filePath)) { modelCache.set(path, null); return null; }
  try {
    const m = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    modelCache.set(path, m);
    return m;
  } catch { modelCache.set(path, null); return null; }
}

async function resolveTextures(
  modelPath: string,
  depth = 0,
): Promise<{ textures: Record<string, string>; ancestors: Set<string> } | null> {
  if (depth > 8) return null;
  const m = await readModel(modelPath);
  if (!m) return null;

  const ancestors = new Set([modelPath]);
  let textures: Record<string, string> = {};
  let hasOwn = false;

  if (m.textures && typeof m.textures === "object") {
    textures = m.textures as Record<string, string>;
    hasOwn = true;
  }

  if (typeof m.parent === "string") {
    const parentPath = m.parent.replace(/^minecraft:/, "");
    ancestors.add(parentPath);
    const parentResult = await resolveTextures(parentPath, depth + 1);
    if (parentResult) {
      for (const a of parentResult.ancestors) ancestors.add(a);
      textures = { ...parentResult.textures, ...textures };
      hasOwn = true;
    }
  }

  return hasOwn ? { textures, ancestors } : null;
}

async function resolveElements(modelPath: string, depth = 0): Promise<unknown[] | null> {
  if (depth > 8) return null;
  const m = await readModel(modelPath);
  if (!m) return null;
  if (Array.isArray(m.elements) && m.elements.length > 0) return m.elements;
  if (typeof m.parent === "string")
    return resolveElements(m.parent.replace(/^minecraft:/, ""), depth + 1);
  return null;
}

function resolveVar(textures: Record<string, string>, key: string, depth = 0): string | null {
  if (depth > 8) return null;
  const v = textures[key];
  if (!v) return null;
  if (v.startsWith("#")) return resolveVar(textures, v.slice(1), depth + 1);
  return v.replace(/^minecraft:/, "");
}

function pickFlat(textures: Record<string, string>): string | null {
  const layer0 = resolveVar(textures, "layer0");
  if (layer0 && !layer0.includes("_overlay") && !layer0.endsWith("_head")) return layer0;
  for (const key of ["layer1", "particle", "all", "top", "texture", "side", "bottom", "layer0"]) {
    const v = resolveVar(textures, key);
    if (v) return v;
  }
  for (const v of Object.values(textures)) {
    if (v && typeof v === "string" && !v.startsWith("#")) return v.replace(/^minecraft:/, "");
  }
  return null;
}

function extractModelRef(modelDef: unknown): string | null {
  if (!modelDef || typeof modelDef !== "object") return null;
  const m = modelDef as Record<string, unknown>;
  switch (m.type) {
    case "minecraft:model":
      return typeof m.model === "string" ? m.model : null;
    case "minecraft:special":
      return typeof m.base === "string" ? m.base : null;
    case "minecraft:select": {
      const cases = m.cases as Array<{ when: unknown; model: unknown }> | undefined;
      if (cases && typeof m.property === "string" && m.property.includes("display_context")) {
        const guiCase = cases.find(
          c => c.when === "gui" || (Array.isArray(c.when) && (c.when as string[]).includes("gui")),
        );
        if (guiCase) return extractModelRef(guiCase.model);
      }
      return extractModelRef(m.fallback) ?? extractModelRef(cases?.[0]?.model);
    }
    case "minecraft:condition":
      return extractModelRef(m.on_false) ?? extractModelRef(m.on_true);
    case "minecraft:range_dispatch":
      return extractModelRef(m.fallback)
        ?? extractModelRef((m.entries as Array<{ model: unknown }>)?.[0]?.model);
    default:
      return null;
  }
}

async function resolveItem(id: string): Promise<{ texture: string; model?: string }> {
  const itemDefPath = join(itemsDir, id + ".json");
  let itemDef: { model?: unknown };
  try { itemDef = JSON.parse(await readFile(itemDefPath, "utf8")); }
  catch { return { texture: `item/${id}` }; }

  const modelRef = extractModelRef(itemDef.model);
  if (!modelRef) return { texture: `item/${id}` };

  const modelPath = modelRef.replace(/^minecraft:/, "");
  const result = await resolveTextures(modelPath);
  if (!result) return { texture: `item/${id}` };

  const { textures, ancestors } = result;
  const flatTexture = pickFlat(textures) ?? `item/${id}`;

  // Block models with elements are rendered browser-side via Three.js
  const isBlockModel = [...ancestors].some(a => a.startsWith("block/"));
  if (isBlockModel) {
    const elements = await resolveElements(modelPath);
    if (elements && elements.length > 0) {
      return { texture: flatTexture, model: modelPath };
    }
  }

  return { texture: flatTexture };
}

const ARMOR_SUFFIXES = ["_helmet", "_chestplate", "_leggings", "_boots", "elytra", "turtle_helmet", "wolf_armor"];
const COMBAT_PARTS = ["_sword", "bow", "crossbow", "trident", "shield", "arrow", "_axe"];
const TOOL_PARTS = ["_pickaxe", "_shovel", "_hoe", "fishing_rod", "flint_and_steel", "shears", "compass", "clock", "lead", "name_tag", "carrot_on_a_stick", "warped_fungus_on_a_stick"];
const POTION_PARTS = ["potion", "tipped_arrow"];
const FOOD_IDS = new Set([
  "bread", "apple", "cooked_beef", "cooked_porkchop", "cooked_chicken", "cooked_cod",
  "cooked_salmon", "cooked_rabbit", "cooked_mutton", "beef", "porkchop", "chicken",
  "cod", "salmon", "tropical_fish", "pufferfish", "rabbit", "mutton",
  "mushroom_stew", "rabbit_stew", "beetroot_soup", "suspicious_stew",
  "honey_bottle", "milk_bucket", "carrot", "potato", "baked_potato", "poisonous_potato",
  "melon_slice", "pumpkin_pie", "cake", "cookie", "dried_kelp", "sweet_berries",
  "glow_berries", "chorus_fruit", "golden_carrot", "golden_apple", "enchanted_golden_apple",
  "spider_eye", "fermented_spider_eye", "rotten_flesh",
]);
function categorize(id: string): string {
  if (ARMOR_SUFFIXES.some(s => id.endsWith(s))) return "armor";
  if (COMBAT_PARTS.some(s => id.includes(s))) return "combat";
  if (TOOL_PARTS.some(s => id.includes(s))) return "tools";
  if (POTION_PARTS.some(s => id.includes(s))) return "potions";
  if (FOOD_IDS.has(id)) return "food";
  return "misc";
}
function toLabel(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

const itemFiles = (await readdir(itemsDir)).filter(f => f.endsWith(".json"));
const ids = itemFiles.map(f => f.replace(/\.json$/, "")).sort();
const SKIP = new Set(["air"]);
const toProcess = ids.filter(id => !SKIP.has(id));
console.log(`Resolving ${toProcess.length} items…`);

const BATCH = 50;
const items: Array<{ id: string; label: string; category: string; texture: string; model?: string }> = [];
for (let i = 0; i < toProcess.length; i += BATCH) {
  const batch = toProcess.slice(i, i + BATCH);
  const results = await Promise.all(batch.map(async id => {
    const { texture, model } = await resolveItem(id);
    return { id, label: toLabel(id), category: categorize(id), texture, ...(model ? { model } : {}) };
  }));
  items.push(...results);
  process.stdout.write(`\r${Math.min(i + BATCH, toProcess.length)}/${toProcess.length}`);
}

await writeFile(OUT_PATH, JSON.stringify(items, null, 2));
console.log(`\nWrote ${items.length} items to ${OUT_PATH}`);
const withModel = items.filter(i => i.model).length;
console.log(`  ${withModel} items have 3D model paths, ${items.length - withModel} use flat textures`);
```

- [ ] **Step 3: Run editor tests to verify LibraryItem change compiles**

```bash
cd editor && npx vitest run
```
Expected: 391 tests pass (LibraryItem change is additive, no tests should break).

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/gen-items.ts editor/src/lib/packApi.ts
git commit -m "refactor(backend): simplify gen-items to output model path instead of pre-rendering icons"
```

---

## Task 3: Remove server-side renderers

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Delete: `backend/src/lib/customItemRenderer.ts`
- Delete: `backend/src/lib/customItemRenderer.test.ts`
- Delete: `backend/src/lib/iconRenderer.ts`

- [ ] **Step 1: Remove renderCustomIcons from hub.ts**

In `backend/src/ws/hub.ts`, remove the import:
```typescript
import { renderCustomIcons } from "../lib/customItemRenderer";
```

And remove lines 328-330 (the `renderCustomIcons` call):
```typescript
      await renderCustomIcons(cacheDir, mcVersion).catch((err) =>
        console.error(`[custom-items] Icon render failed for server ${serverId}:`, err)
      );
```

- [ ] **Step 2: Delete the three files**

```bash
cd backend
rm src/lib/customItemRenderer.ts src/lib/customItemRenderer.test.ts src/lib/iconRenderer.ts
```

- [ ] **Step 3: Verify backend tests still pass**

```bash
cd backend && bun test
```
Expected: all tests pass (customItemRenderer.test.ts is deleted so those 6 tests are gone; the remaining ~97 should all pass).

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "remove(backend): delete server-side icon renderers (iconRenderer, customItemRenderer)"
```

---

## Task 4: Editor — Three.js mcModelRenderer

**Files:**
- Create: `editor/src/lib/mcModelRenderer.ts`
- Create: `editor/src/lib/mcModelRenderer.test.ts`

Install Three.js first:

- [ ] **Step 1: Install three**

```bash
cd editor && npm install three @types/three
```

- [ ] **Step 2: Write failing tests**

Create `editor/src/lib/mcModelRenderer.test.ts`:

```typescript
import { describe, test, expect, vi, beforeEach } from "vitest";
import { resolveModel } from "./mcModelRenderer";

// resolveModel only uses fetch — no WebGL needed. We mock fetch globally.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("resolveModel", () => {
  test("returns null when model fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    const result = await resolveModel("block/stone", "1.21.4");
    expect(result).toBeNull();
  });

  test("returns elements and textures from a flat model", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "#all" } } }],
        textures: { all: "block/stone" },
      }),
    } as Response);

    const result = await resolveModel("block/stone", "1.21.4");
    expect(result).not.toBeNull();
    expect(result!.elements).toHaveLength(1);
    expect(result!.textures.all).toBe("block/stone");
  });

  test("walks parent chain and merges textures (child overrides parent)", async () => {
    const child = { parent: "block/cube_all", textures: { all: "block/diamond_block" } };
    const parent = {
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "#all" } } }],
      textures: { all: "block/stone" },
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(child) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(parent) } as Response);

    const result = await resolveModel("block/diamond_block", "1.21.4");
    expect(result).not.toBeNull();
    expect(result!.textures.all).toBe("block/diamond_block"); // child wins
    expect(result!.elements).toHaveLength(1);                 // from parent
  });

  test("uses custom models endpoint for custom items", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    await resolveModel("nexo/forest_sword", "1.21.4", true, "srv_abc");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining("/api/models/custom/srv_abc/nexo/forest_sword"),
    );
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd editor && npx vitest run src/lib/mcModelRenderer.test.ts
```
Expected: fails — module not found.

- [ ] **Step 4: Create `editor/src/lib/mcModelRenderer.ts`**

```typescript
import * as THREE from "three";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ModelFace {
  texture: string;
  uv?: [number, number, number, number];
  rotation?: number;
  cullface?: string;
}

interface ModelElement {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: { origin: [number, number, number]; axis: "x" | "y" | "z"; angle: number; rescale?: boolean };
  faces: Partial<Record<"down" | "up" | "north" | "south" | "west" | "east", ModelFace>>;
}

interface DisplayTransform {
  rotation?: [number, number, number];
  translation?: [number, number, number];
  scale?: [number, number, number];
}

export interface ResolvedModel {
  elements: ModelElement[];
  textures: Record<string, string>;
  display?: DisplayTransform;
  guiLight: "front" | "side";
}

// ── Singleton renderer + camera ────────────────────────────────────────────────

let _renderer: THREE.WebGLRenderer | null = null;
let _camera: THREE.OrthographicCamera | null = null;

function getRenderer(): THREE.WebGLRenderer {
  if (!_renderer) {
    _renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    _renderer.setSize(128, 128);
    _renderer.setClearColor(0x000000, 0);
  }
  return _renderer;
}

function getCamera(): THREE.OrthographicCamera {
  if (!_camera) {
    // Model space: 0-16 units per block, centered at (8,8,8) → group offset to origin.
    // Camera sees ±10 units to give margin around the 8-unit radius of a full block.
    _camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
    _camera.position.set(0, 0, 100);
    _camera.lookAt(0, 0, 0);
  }
  return _camera;
}

// ── Render cache ───────────────────────────────────────────────────────────────

const renderCache = new Map<string, Promise<string | null>>();

function cacheKey(modelPath: string, version: string, isCustom: boolean, serverKeyId?: string): string {
  return isCustom ? `custom:${serverKeyId}:${modelPath}` : `${version}:${modelPath}`;
}

// ── Model fetching + resolution ────────────────────────────────────────────────

async function fetchModel(
  modelPath: string, version: string, isCustom: boolean, serverKeyId?: string,
): Promise<Record<string, unknown> | null> {
  const url = isCustom
    ? `${API_URL}/api/models/custom/${serverKeyId}/${modelPath}`
    : `${API_URL}/api/models/${version}/${modelPath}`;
  try {
    const res = await fetch(url);
    return res.ok ? (res.json() as Promise<Record<string, unknown>>) : null;
  } catch {
    return null;
  }
}

export async function resolveModel(
  modelPath: string,
  version: string,
  isCustom = false,
  serverKeyId?: string,
  depth = 0,
): Promise<ResolvedModel | null> {
  if (depth > 8) return null;
  const m = await fetchModel(modelPath, version, isCustom, serverKeyId);
  if (!m) return null;

  let result: ResolvedModel = { elements: [], textures: {}, guiLight: "side" };

  if (typeof m.parent === "string") {
    const parentPath = (m.parent as string).replace(/^minecraft:/, "");
    const parentResult = await resolveModel(parentPath, version, false, undefined, depth + 1);
    if (parentResult) result = { ...parentResult };
  }

  if (m.textures && typeof m.textures === "object") {
    result.textures = { ...result.textures, ...(m.textures as Record<string, string>) };
  }
  if (Array.isArray(m.elements) && (m.elements as unknown[]).length > 0) {
    result.elements = m.elements as ModelElement[];
  }

  const display = m.display as Record<string, unknown> | undefined;
  if (display?.gui) result.display = display.gui as DisplayTransform;
  if (m.gui_light === "front") result.guiLight = "front";
  else if (m.gui_light === "side") result.guiLight = "side";

  return result;
}

// ── Texture variable resolution ────────────────────────────────────────────────

function resolveVar(textures: Record<string, string>, key: string, depth = 0): string | null {
  if (depth > 8) return null;
  const v = textures[key];
  if (!v) return null;
  if (v.startsWith("#")) return resolveVar(textures, v.slice(1), depth + 1);
  return v.replace(/^minecraft:/, "");
}

// ── Texture loading ─────────────────────────────────────────────────────────────

const texCache = new Map<string, THREE.Texture | null>();

function loadTex(url: string): Promise<THREE.Texture | null> {
  if (texCache.has(url)) return Promise.resolve(texCache.get(url)!);
  return new Promise(resolve => {
    new THREE.TextureLoader().load(
      url,
      tex => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        texCache.set(url, tex);
        resolve(tex);
      },
      undefined,
      () => { texCache.set(url, null); resolve(null); },
    );
  });
}

async function loadModelTextures(
  model: ResolvedModel, version: string, isCustom: boolean, serverKeyId?: string,
): Promise<Map<string, THREE.Texture>> {
  const resolved = new Map<string, string>();
  for (const key of Object.keys(model.textures)) {
    const path = resolveVar(model.textures, key);
    if (path) resolved.set(key, path);
  }

  const out = new Map<string, THREE.Texture>();
  await Promise.all([...resolved.entries()].map(async ([key, path]) => {
    const url = isCustom
      ? `${API_URL}/api/textures/custom/${serverKeyId}/${path}`
      : `${API_URL}/api/textures/${version}/${path}`;
    const tex = await loadTex(url);
    if (tex) out.set(key, tex);
  }));
  return out;
}

// ── Scene building ─────────────────────────────────────────────────────────────

// Face vertex positions in 0-16 space (viewed from outside, CCW winding):
function faceVerts(
  face: "down" | "up" | "north" | "south" | "west" | "east",
  fx: number, fy: number, fz: number,
  tx: number, ty: number, tz: number,
): number[] {
  switch (face) {
    case "down":  return [fx,fy,tz, tx,fy,tz, tx,fy,fz, fx,fy,fz];
    case "up":    return [fx,ty,fz, tx,ty,fz, tx,ty,tz, fx,ty,tz];
    case "north": return [tx,ty,fz, fx,ty,fz, fx,fy,fz, tx,fy,fz];
    case "south": return [fx,ty,tz, tx,ty,tz, tx,fy,tz, fx,fy,tz];
    case "west":  return [fx,ty,fz, fx,ty,tz, fx,fy,tz, fx,fy,fz];
    case "east":  return [tx,ty,tz, tx,ty,fz, tx,fy,fz, tx,fy,tz];
  }
}

// Default UV for a face when not specified (from Minecraft wiki):
function defaultUV(
  face: "down" | "up" | "north" | "south" | "west" | "east",
  from: [number,number,number], to: [number,number,number],
): [number,number,number,number] {
  const [fx,fy,fz] = from; const [tx,ty,tz] = to;
  switch (face) {
    case "down":  return [fx, 16-tz, tx, 16-fz];
    case "up":    return [fx, fz,    tx, tz];
    case "north": return [16-tx, 16-ty, 16-fx, 16-fy];
    case "south": return [fx, 16-ty, tx, 16-fy];
    case "west":  return [fz, 16-ty, tz, 16-fy];
    case "east":  return [16-tz, 16-ty, 16-fz, 16-fy];
  }
}

// Minecraft face UV (top-left origin, y↓, 0-16) → Three.js UV (bottom-left, y↑, 0-1),
// with clockwise texture rotation applied.
function faceUVs(u1: number, v1: number, u2: number, v2: number, rotation: number): Float32Array {
  const corners: [number, number][] = [
    [u1/16, 1-v1/16], // TL
    [u2/16, 1-v1/16], // TR
    [u2/16, 1-v2/16], // BR
    [u1/16, 1-v2/16], // BL
  ];
  const steps = ((rotation / 90) % 4 + 4) % 4;
  const uv = (i: number) => corners[((i - steps) % 4 + 4) % 4]!;
  return new Float32Array([
    ...uv(0), ...uv(1), ...uv(2),
    ...uv(0), ...uv(2), ...uv(3),
  ]);
}

function buildFaceMesh(
  face: "down" | "up" | "north" | "south" | "west" | "east",
  faceData: ModelFace,
  from: [number,number,number],
  to: [number,number,number],
  textures: Map<string, THREE.Texture>,
  modelTextures: Record<string, string>,
): THREE.Mesh | null {
  const texKey = faceData.texture.startsWith("#")
    ? faceData.texture.slice(1)
    : faceData.texture;
  const resolvedKey = resolveVar(modelTextures, texKey) ?? texKey;
  // Try to find texture by resolved path key or by original key
  const tex = textures.get(resolvedKey) ?? textures.get(texKey);
  if (!tex) return null;

  const [fx,fy,fz] = from; const [tx,ty,tz] = to;
  const verts = faceVerts(face, fx, fy, fz, tx, ty, tz);
  // Triangles from quad [v0,v1,v2,v3]: [v0,v1,v2] and [v0,v2,v3]
  const positions = new Float32Array([
    ...verts.slice(0,3), ...verts.slice(3,6), ...verts.slice(6,9),
    ...verts.slice(0,3), ...verts.slice(6,9), ...verts.slice(9,12),
  ]);

  const [u1,v1,u2,v2] = faceData.uv ?? defaultUV(face, from, to);
  const uvs = faceUVs(u1, v1, u2, v2, faceData.rotation ?? 0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.01, side: THREE.FrontSide });
  return new THREE.Mesh(geo, mat);
}

function buildScene(model: ResolvedModel, textures: Map<string, THREE.Texture>): THREE.Scene {
  const scene = new THREE.Scene();
  const modelGroup = new THREE.Group();
  // Center model at origin (Minecraft elements are in 0-16 space)
  modelGroup.position.set(-8, -8, -8);
  scene.add(modelGroup);

  const FACES = ["down", "up", "north", "south", "west", "east"] as const;

  for (const elem of model.elements) {
    const elemGroup = new THREE.Group();

    // Apply element rotation around its origin point
    if (elem.rotation) {
      const { origin, axis, angle } = elem.rotation;
      const rad = THREE.MathUtils.degToRad(angle);
      const pivot = new THREE.Group();
      pivot.position.set(origin[0] - 8, origin[1] - 8, origin[2] - 8);
      const inner = new THREE.Group();
      inner.position.set(-(origin[0] - 8), -(origin[1] - 8), -(origin[2] - 8));
      if (axis === "x") pivot.rotation.x = rad;
      else if (axis === "y") pivot.rotation.y = rad;
      else if (axis === "z") pivot.rotation.z = rad;
      pivot.add(inner);
      for (const face of FACES) {
        const faceData = elem.faces[face];
        if (!faceData) continue;
        const mesh = buildFaceMesh(face, faceData, elem.from, elem.to, textures, model.textures);
        if (mesh) inner.add(mesh);
      }
      elemGroup.add(pivot);
    } else {
      for (const face of FACES) {
        const faceData = elem.faces[face];
        if (!faceData) continue;
        const mesh = buildFaceMesh(face, faceData, elem.from, elem.to, textures, model.textures);
        if (mesh) elemGroup.add(mesh);
      }
    }

    modelGroup.add(elemGroup);
  }

  // Apply display.gui transform (Minecraft order: scale → YXZ rotation → translation)
  const displayGroup = new THREE.Group();
  scene.remove(modelGroup);
  displayGroup.add(modelGroup);
  scene.add(displayGroup);

  const display = model.display ?? {
    rotation: [30, 225, 0],
    translation: [0, 0, 0],
    scale: [0.625, 0.625, 0.625],
  };

  if (display.scale) {
    const [sx, sy, sz] = display.scale;
    displayGroup.scale.set(Math.min(4, sx), Math.min(4, sy), Math.min(4, sz));
  }
  if (display.rotation) {
    const [rx, ry, rz] = display.rotation;
    displayGroup.rotation.order = "YXZ";
    displayGroup.rotation.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
    );
  }
  if (display.translation) {
    const [tx, ty, tz] = display.translation;
    displayGroup.position.set(
      Math.max(-80, Math.min(80, tx)),
      Math.max(-80, Math.min(80, ty)),
      Math.max(-80, Math.min(80, tz)),
    );
  }

  return scene;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function renderToCanvas(
  modelPath: string,
  version: string,
  isCustom = false,
  serverKeyId?: string,
): Promise<string | null> {
  const key = cacheKey(modelPath, version, isCustom, serverKeyId);
  if (renderCache.has(key)) return renderCache.get(key)!;

  const promise = (async (): Promise<string | null> => {
    const model = await resolveModel(modelPath, version, isCustom, serverKeyId);
    if (!model || model.elements.length === 0) return null;

    const textures = await loadModelTextures(model, version, isCustom, serverKeyId);
    if (textures.size === 0) return null;

    const scene = buildScene(model, textures);
    const renderer = getRenderer();
    const camera = getCamera();

    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  })();

  renderCache.set(key, promise);
  return promise;
}
```

- [ ] **Step 5: Run editor tests to verify resolveModel tests pass**

```bash
cd editor && npx vitest run src/lib/mcModelRenderer.test.ts
```
Expected: 4 tests pass (`resolveModel` tests only use fetch, no WebGL).

- [ ] **Step 6: Full editor test suite regression check**

```bash
cd editor && npx vitest run
```
Expected: 391+ tests pass (new tests added, no regressions).

- [ ] **Step 7: Commit**

```bash
git add editor/src/lib/mcModelRenderer.ts editor/src/lib/mcModelRenderer.test.ts editor/package.json editor/package-lock.json
git commit -m "feat(editor): add Three.js mcModelRenderer for browser-side Minecraft item rendering"
```

---

## Task 5: Update ItemTile for lazy 3D canvas rendering

**Files:**
- Modify: `editor/src/features/canvas/Library.tsx`

The `ItemTile` component must:
- Show flat `<img>` for items without a `model` field (unchanged behaviour)
- For items with `model`: use IntersectionObserver to lazily call `renderToCanvas` when the tile enters the viewport, display the returned data URL in an `<img>`, show flat texture as placeholder while loading

`Library.tsx` currently passes `textureBase` but not `version`/`serverKeyId` to `ItemTile`. We need those for `renderToCanvas`.

- [ ] **Step 1: Update `Library.tsx`**

Replace the `ItemTile` interface and component (lines 16-58):

```typescript
interface ItemTileProps {
  item: LibraryItem;
  textureBase: string;
  version: string;
  isCustom: boolean;
  serverKeyId?: string;
}

function ItemTile({ item, textureBase, version, isCustom, serverKeyId }: ItemTileProps) {
  const flatUrl = `${textureBase}/${item.texture}`;
  const armed = useUiStore((s) => s.armedMaterial === item.id);
  const setArmedMaterial = useUiStore((s) => s.setArmedMaterial);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${LIBRARY_DRAG_PREFIX}${item.id}`,
    data: { material: item.id },
  });
  const tileRef = useRef<HTMLButtonElement>(null);
  const [renderedSrc, setRenderedSrc] = useState<string | null>(null);
  const style: CSSProperties = { opacity: isDragging ? 0.4 : 1 };

  useEffect(() => {
    if (!item.model || !tileRef.current) return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      observer.disconnect();
      renderToCanvas(item.model!, version, isCustom, serverKeyId).then((src) => {
        if (!cancelled && src) setRenderedSrc(src);
      });
    }, { threshold: 0 });
    observer.observe(tileRef.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [item.model, version, isCustom, serverKeyId]);

  return (
    <button
      ref={(el) => { setNodeRef(el); (tileRef as React.MutableRefObject<HTMLButtonElement | null>).current = el; }}
      type="button"
      style={style}
      onClick={() => setArmedMaterial(armed ? null : item.id)}
      title={item.label}
      {...listeners}
      {...attributes}
      className={cx(
        "group relative flex h-16 w-16 shrink-0 select-none touch-none items-center justify-center",
        "rounded border bg-[#8b8b8b] active:cursor-grabbing",
        armed
          ? "border-emerald-500 bg-emerald-500/20 ring-1 ring-emerald-500"
          : "border-zinc-600 cursor-grab hover:border-zinc-400",
      )}
    >
      <img
        src={renderedSrc ?? flatUrl}
        alt={item.label}
        loading="lazy"
        draggable={false}
        className="h-full w-full object-contain p-1"
        style={{ imageRendering: renderedSrc ? "auto" : "pixelated" }}
        onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
      />
    </button>
  );
}
```

Add imports at the top of `Library.tsx`:
```typescript
import { useRef, useEffect, useState } from "react";
import { renderToCanvas } from "@/lib/mcModelRenderer";
```

(Remove the old single `useEffect, useState` import line and merge with the new one.)

Update the `ItemTile` call site in `Library.tsx` (around line 131-135) to pass the new props:

```typescript
{filtered.map((item) => {
  const isCustom = customData.items.some((c) => c.id === item.id);
  const textureBase = isCustom
    ? `${API_URL}/api/textures/custom/${customData.serverKeyId}`
    : `${API_URL}/api/textures/${version}`;
  return (
    <ItemTile
      key={item.id}
      item={item}
      textureBase={textureBase}
      version={version}
      isCustom={isCustom}
      serverKeyId={isCustom ? customData.serverKeyId : undefined}
    />
  );
})}
```

- [ ] **Step 2: Run editor tests**

```bash
cd editor && npx vitest run
```
Expected: 391+ tests pass.

- [ ] **Step 3: Commit**

```bash
git add editor/src/features/canvas/Library.tsx
git commit -m "feat(editor): render 3D block items via Three.js canvas in Library ItemTile"
```

---

## Task 6: Regenerate items list + smoke test

**Files:**
- Modify: `backend/data/items/1.21.4.json` (regenerated)

- [ ] **Step 1: Regenerate items JSON**

The backend must be running (so assets are downloaded). If not, start it and wait for the `.done` sentinel:

```bash
cd backend && bun run dev
# In another terminal, once assets are confirmed downloaded:
bun run backend/scripts/gen-items.ts 1.21.4
```

Expected output: `Resolving 1401 items… 1401/1401` and a summary line showing how many items have 3D model paths (expect ~700-800 block items).

- [ ] **Step 2: Spot-check the JSON**

```bash
node -e "const j=require('./backend/data/items/1.21.4.json'); const m=j.filter(i=>i.model); console.log('with model:', m.length); console.log('dispenser:', j.find(i=>i.id==='dispenser')); console.log('diamond_sword:', j.find(i=>i.id==='diamond_sword'));"
```

Expected:
```
with model: ~700
dispenser: { id: 'dispenser', ..., texture: 'block/...', model: 'block/dispenser' }
diamond_sword: { id: 'diamond_sword', ..., texture: 'item/diamond_sword' }  // no model (flat)
```

- [ ] **Step 3: Start editor and verify in browser**

```bash
cd editor && npm run dev
```

Open http://localhost:5173, navigate to the Library panel:
- Flat items (diamond_sword, bow, etc.) show their flat sprite immediately ✓
- Block items (dispenser, chest, furnace, etc.) show flat texture placeholder, then switch to 3D-rendered image when they scroll into view ✓
- Custom Nexo/Oraxen items with model JSONs render in 3D ✓

- [ ] **Step 4: Commit regenerated items JSON**

```bash
git add backend/data/items/1.21.4.json
git commit -m "chore: regenerate items list with model paths for Three.js renderer"
```

---

## Self-Review

**Spec coverage:**
- ✅ Backend model routes (vanilla + custom)
- ✅ gen-items.ts simplified with `model` field
- ✅ customItemRenderer.ts + iconRenderer.ts removed
- ✅ LibraryItem type updated
- ✅ Editor Three.js renderer with parent chain, UV mapping, element rotation, display.gui transform
- ✅ Singleton WebGLRenderer (one per app)
- ✅ Lazy rendering via IntersectionObserver
- ✅ LRU-style cache (Map keyed by model path + version)
- ✅ Flat texture fallback while loading (and for flat items permanently)
- ✅ `imageRendering: pixelated` for flat, `auto` for rendered
- ✅ Tests: 2 backend model route tests suites (5 tests), 4 editor resolveModel tests

**Placeholder scan:** None found — all steps contain real code and real commands.

**Type consistency:**
- `ResolvedModel` defined in Task 4 used by `resolveModel`, `buildScene`, `renderToCanvas` ✓
- `LibraryItem.model?: string` added in Task 2, consumed in Task 5 ✓
- `ItemTileProps.version/isCustom/serverKeyId` added and passed from call site ✓
