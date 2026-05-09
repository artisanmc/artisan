import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile, readFile } from "fs/promises";
import { unlinkSync } from "fs";
import { PNG } from "pngjs";
import { assetsRoot } from "./mcAssets";
import { renderIsometricIcon, renderFromElements, type ModelElement } from "./iconRenderer";
import type { CustomItemEntry } from "./customItems";

const CUBE_PARENTS = new Set([
  "block/cube_all",
  "block/cube",
  "block/cube_column",
  "block/cube_column_horizontal",
  "block/cube_bottom_top",
  "block/cube_directional",
  "block/cube_mirrored_all",
  "block/cube_all_directional",
  "block/leaves",
  "block/template_glass",
  "block/template_glazed_terracotta",
  "item/template_shulker_box",
  "item/template_chest",
]);

type ModelJson = Record<string, unknown>;

function readModelJson(path: string): ModelJson | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
}

function resolveVar(textures: Record<string, string>, key: string, depth = 0): string | null {
  if (depth > 8) return null;
  const v = textures[key];
  if (!v) return null;
  if (v.startsWith("#")) return resolveVar(textures, v.slice(1), depth + 1);
  return v.replace(/^minecraft:/, "");
}

function getCubeTextures(textures: Record<string, string>): { top: string; side: string } | null {
  const r = (key: string) => resolveVar(textures, key);
  const top = r("up") ?? r("top") ?? r("end") ?? r("all") ?? r("particle");
  const side = r("side") ?? r("north") ?? r("east") ?? r("west") ?? r("all") ?? r("particle") ?? top;
  if (!top || !side) return null;
  return { top, side };
}

type ResolvedParent = {
  textures: Record<string, string>;
  ancestors: Set<string>;
  elements: ModelElement[] | null;
};

function resolveVanillaParent(
  modelPath: string,
  vanillaModelsDir: string,
  depth = 0,
): ResolvedParent {
  const empty: ResolvedParent = { textures: {}, ancestors: new Set([modelPath]), elements: null };
  if (depth > 8) return empty;
  const m = readModelJson(join(vanillaModelsDir, modelPath + ".json"));
  if (!m) return empty;

  let textures: Record<string, string> = {};
  let elements: ModelElement[] | null = null;
  const ancestors = new Set([modelPath]);

  if (m.textures && typeof m.textures === "object")
    textures = m.textures as Record<string, string>;
  if (Array.isArray(m.elements) && m.elements.length > 0)
    elements = m.elements as ModelElement[];

  if (typeof m.parent === "string") {
    const pp = m.parent.replace(/^minecraft:/, "");
    ancestors.add(pp);
    const pr = resolveVanillaParent(pp, vanillaModelsDir, depth + 1);
    for (const a of pr.ancestors) ancestors.add(a);
    textures = { ...pr.textures, ...textures };
    if (elements === null && pr.elements) elements = pr.elements;
  }
  return { textures, ancestors, elements };
}

function loadPng(path: string): PNG | null {
  if (!existsSync(path)) return null;
  try { return PNG.sync.read(readFileSync(path)); }
  catch { return null; }
}

function buildTextureMap(
  textures: Record<string, string>,
  cacheTexturesDir: string,
  vanillaTexturesDir: string,
): Map<string, PNG> {
  const map = new Map<string, PNG>();
  for (const [key] of Object.entries(textures)) {
    const resolved = resolveVar(textures, key);
    if (!resolved) continue;
    const noNs = resolved.includes(":") ? resolved.split(":")[1]! : resolved;
    const lastComponent = noNs.split("/").pop()!;
    const nsPart = resolved.includes(":") ? resolved.split(":")[0]! : "";
    const customPath = nsPart
      ? join(cacheTexturesDir, nsPart, lastComponent + ".png")
      : join(cacheTexturesDir, noNs + ".png");
    const png = loadPng(customPath) ?? loadPng(join(vanillaTexturesDir, noNs + ".png"));
    if (png) map.set(key, png);
  }
  return map;
}

export async function renderCustomIconsWithPaths(
  cacheDir: string,
  vanillaRoot: string,
): Promise<void> {
  const itemsPath = join(cacheDir, "items.json");
  if (!existsSync(itemsPath)) return;

  const items: CustomItemEntry[] = JSON.parse(readFileSync(itemsPath, "utf8"));
  const vanillaModelsDir = join(vanillaRoot, "models");
  const vanillaTexturesDir = join(vanillaRoot, "textures");
  const cacheTexturesDir = join(cacheDir, "textures");
  const iconsDir = join(cacheDir, "textures", "icons");

  await mkdir(iconsDir, { recursive: true });

  let changed = false;
  for (const item of items) {
    const modelPath = join(cacheDir, "models", item.texture + ".json");
    if (!existsSync(modelPath)) continue;

    const modelJson = readModelJson(modelPath);
    if (!modelJson) continue;

    let textures: Record<string, string> =
      modelJson.textures && typeof modelJson.textures === "object"
        ? (modelJson.textures as Record<string, string>)
        : {};
    let elements: ModelElement[] | null =
      Array.isArray(modelJson.elements) && modelJson.elements.length > 0
        ? (modelJson.elements as ModelElement[])
        : null;
    const ancestors = new Set<string>();

    if (typeof modelJson.parent === "string") {
      const parentPath = modelJson.parent.includes(":")
        ? modelJson.parent.split(":")[1]!
        : modelJson.parent;
      ancestors.add(parentPath);
      const pr = resolveVanillaParent(parentPath, vanillaModelsDir);
      for (const a of pr.ancestors) ancestors.add(a);
      textures = { ...pr.textures, ...textures };
      if (elements === null && pr.elements) elements = pr.elements;
    }

    const isBlockModel = [...ancestors].some(a => a.startsWith("block/"));
    if (!isBlockModel) continue;

    const iconName = item.texture.replace(/\//g, "__");
    const iconPath = join(iconsDir, iconName + ".png");
    let rendered = false;

    if (elements && elements.length > 0) {
      const textureMap = buildTextureMap(textures, cacheTexturesDir, vanillaTexturesDir);
      if (textureMap.size > 0) {
        try {
          const buf = renderFromElements(elements, textureMap);
          await writeFile(iconPath, buf);
          rendered = true;
        } catch { /* fall through */ }
      }
    }

    if (!rendered) {
      for (const a of ancestors) {
        if (!CUBE_PARENTS.has(a)) continue;
        const faces = getCubeTextures(textures);
        if (!faces) break;
        const topFile = join(vanillaTexturesDir, faces.top + ".png");
        const sideFile = join(vanillaTexturesDir, faces.side + ".png");
        const topPng = loadPng(topFile) ?? loadPng(join(cacheTexturesDir, faces.top.split("/").pop()! + ".png"));
        const sidePng = loadPng(sideFile) ?? loadPng(join(cacheTexturesDir, faces.side.split("/").pop()! + ".png"));
        if (topPng && sidePng) {
          const topTmp = join(iconsDir, "_top_tmp.png");
          const sideTmp = join(iconsDir, "_side_tmp.png");
          await writeFile(topTmp, PNG.sync.write(topPng));
          await writeFile(sideTmp, PNG.sync.write(sidePng));
          try {
            const buf = renderIsometricIcon(topTmp, sideTmp);
            await writeFile(iconPath, buf);
            rendered = true;
          } catch { /* fall through */ }
          try { unlinkSync(topTmp); } catch { /**/ }
          try { unlinkSync(sideTmp); } catch { /**/ }
        }
        break;
      }
    }

    if (rendered) {
      item.texture = `icons/${iconName}`;
      changed = true;
    }
  }

  if (changed) {
    await writeFile(itemsPath, JSON.stringify(items));
  }
}

export async function renderCustomIcons(cacheDir: string, mcVersion: string): Promise<void> {
  return renderCustomIconsWithPaths(cacheDir, assetsRoot(mcVersion));
}
