import { Hono } from "hono";
import { join } from "path";
import { existsSync } from "fs";
import { readFile, readdir } from "fs/promises";
import { assetsRoot } from "../lib/mcAssets";
import { customItemsCacheDir, SERVER_KEY_ID_PATTERN } from "../lib/customItems";

const router = new Hono();

// ── Types (mirror editor's ResolvedModel) ─────────────────────────────────────

interface ResolvedModel {
  elements: unknown[];
  textures: Record<string, string>;
  display?: { rotation?: [number, number, number]; translation?: [number, number, number]; scale?: [number, number, number] };
  guiLight: "front" | "side";
}

// ── Disk-level model JSON cache ────────────────────────────────────────────────

const diskCache = new Map<string, Record<string, unknown> | null>();

async function readModelJson(
  modelPath: string,
  modelsDir: string,
): Promise<Record<string, unknown> | null> {
  const key = `${modelsDir}::${modelPath}`;
  if (diskCache.has(key)) return diskCache.get(key)!;
  const filePath = join(modelsDir, modelPath + ".json");
  if (!existsSync(filePath)) { diskCache.set(key, null); return null; }
  try {
    const json = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
    diskCache.set(key, json);
    return json;
  } catch {
    diskCache.set(key, null);
    return null;
  }
}

// ── Model chain resolution ─────────────────────────────────────────────────────
// Mirrors the logic in editor/src/lib/mcModelRenderer.ts resolveModel().
// Parents always resolve from vanillaDir (matches what the frontend does with isCustom=false).

async function resolveChain(
  modelPath: string,
  dir: string,
  vanillaDir: string,
  depth = 0,
): Promise<ResolvedModel | null> {
  if (depth > 8) return null;
  const m = await readModelJson(modelPath, dir);
  if (!m) return null;

  let result: ResolvedModel = { elements: [], textures: {}, guiLight: "side" };

  if (typeof m.parent === "string") {
    const parentPath = (m.parent as string).replace(/^minecraft:/, "");
    const parentResult = await resolveChain(parentPath, vanillaDir, vanillaDir, depth + 1);
    if (parentResult) result = { ...parentResult };
  }

  if (m.textures && typeof m.textures === "object") {
    result.textures = { ...result.textures, ...(m.textures as Record<string, string>) };
  }
  if (Array.isArray(m.elements) && (m.elements as unknown[]).length > 0) {
    result.elements = m.elements as unknown[];
  }

  const display = m.display as Record<string, unknown> | undefined;
  if (display?.gui) result.display = display.gui as ResolvedModel["display"];
  if (m.gui_light === "front") result.guiLight = "front";
  else if (m.gui_light === "side") result.guiLight = "side";

  return result;
}

// ── Bundle builders ────────────────────────────────────────────────────────────

const DATA_DIR = join(import.meta.dir, "../../data");

export async function buildVanillaBundle(version: string): Promise<Record<string, ResolvedModel>> {
  // Fall back to any available 1.21.x if exact version has no items JSON
  const [major, minor] = version.split(".");
  let itemsPath = join(DATA_DIR, "items", `${version}.json`);
  if (!existsSync(itemsPath)) {
    try {
      const entries = await readdir(join(DATA_DIR, "items"));
      const match = entries
        .filter(e => e.startsWith(`${major}.${minor}.`) && e.endsWith(".json"))
        .sort()
        .at(-1);
      if (match) itemsPath = join(DATA_DIR, "items", match);
    } catch { /* no items at all */ }
  }
  if (!existsSync(itemsPath)) return {};

  const items = JSON.parse(await readFile(itemsPath, "utf-8")) as Array<{ model?: string }>;
  const modelPaths = [...new Set(items.filter(i => i.model).map(i => i.model!))];

  const vanillaDir = join(assetsRoot(version), "models");
  const entries = await Promise.all(
    modelPaths.map(async (path) => {
      const resolved = await resolveChain(path, vanillaDir, vanillaDir);
      return resolved ? ([path, resolved] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter(Boolean) as Array<[string, ResolvedModel]>);
}

async function buildCustomBundle(
  serverKeyId: string,
  version: string,
): Promise<Record<string, ResolvedModel>> {
  const customModelsDir = join(customItemsCacheDir(serverKeyId), "models");
  if (!existsSync(customModelsDir)) return {};

  const vanillaDir = join(assetsRoot(version), "models");

  let files: string[];
  try {
    files = (await readdir(customModelsDir, { recursive: true }) as string[])
      .filter(f => f.endsWith(".json"));
  } catch { return {}; }

  const modelPaths = files.map(f => f.replace(/\\/g, "/").replace(/\.json$/, ""));
  const entries = await Promise.all(
    modelPaths.map(async (path) => {
      const resolved = await resolveChain(path, customModelsDir, vanillaDir);
      return resolved ? ([path, resolved] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter(Boolean) as Array<[string, ResolvedModel]>);
}

// ── In-memory bundle cache ─────────────────────────────────────────────────────

const bundleCache = new Map<string, Promise<Record<string, ResolvedModel>>>();

/** Call after a new custom_items_bundle is received to force regeneration. */
export function invalidateCustomBundle(serverKeyId: string): void {
  bundleCache.delete(`custom:${serverKeyId}`);
  for (const key of diskCache.keys()) {
    if (key.includes(customItemsCacheDir(serverKeyId))) diskCache.delete(key);
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

const VERSION = /^\d+(\.\d+)+$/;

router.get(`/custom/:serverKeyId{${SERVER_KEY_ID_PATTERN}}`, async (c) => {
  const serverKeyId = c.req.param("serverKeyId");
  const version = c.req.query("version") ?? "1.21.4";
  if (!VERSION.test(version)) return c.json({ error: "invalid_version" }, 400);
  if (!existsSync(customItemsCacheDir(serverKeyId))) return c.json({}, 200, { "Cache-Control": "no-cache" });
  const cacheKey = `custom:${serverKeyId}`;
  if (!bundleCache.has(cacheKey)) {
    bundleCache.set(cacheKey, buildCustomBundle(serverKeyId, version));
  }
  return c.json(await bundleCache.get(cacheKey)!, 200, { "Cache-Control": "no-cache" });
});

router.get(String.raw`/:version{\d+(?:\.\d+)+}`, async (c) => {
  const version = c.req.param("version");
  if (!bundleCache.has(version)) {
    bundleCache.set(version, buildVanillaBundle(version));
  }
  const bundle = await bundleCache.get(version)!;
  // Only versions with assets on disk stay cached — the map can't grow per request.
  if (Object.keys(bundle).length === 0) bundleCache.delete(version);
  return c.json(bundle, 200, {
    "Cache-Control": "public, max-age=604800",
  });
});

export { router as modelBundleRouter };
