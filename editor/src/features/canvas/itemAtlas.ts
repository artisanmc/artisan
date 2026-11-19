import type { LibraryItem } from "@/domain/library";
import { API_URL, apiRequest } from "@/lib/api/client";
import type { CSSProperties } from "react";
import { type ItemAtlas, useTextureStore } from "./textureStore";

/** Columns of the hub's atlas (`VanillaAssets.ATLAS_COLUMNS`): item `i` sits at `i % 32`, `i / 32`. */
export const ATLAS_COLUMNS = 32;
/** While the hub is still downloading the textures or icons (503), asked again this often. */
const RETRY_MS = 20_000;
const RETRIES = 6;

/**
 * The catalogue's pictures in one request (`GET /api/v1/item-atlas/:version`), in the order of
 * [items], the order the hub draws them in. Until it is here, or if it never comes, the grids
 * load each picture by itself, as before.
 */
export async function loadItemAtlas(
  version: string,
  items: LibraryItem[],
  isCurrent: () => boolean,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await wait(RETRY_MS);
    if (!isCurrent()) return;
    let res: Response;
    try {
      res = await apiRequest(`${API_URL}/api/v1/item-atlas/${encodeURIComponent(version)}`);
    } catch {
      return;
    }
    if (res.status === 503) continue;
    if (!res.ok) return;
    const blob = await res.blob();
    if (!isCurrent()) return;
    const index: Record<string, number> = {};
    items.forEach((item, i) => {
      index[item.id.toLowerCase()] = i;
    });
    useTextureStore.getState().setAtlas({
      url: URL.createObjectURL(blob),
      rows: Math.max(1, Math.ceil(items.length / ATLAS_COLUMNS)),
      index,
    });
    return;
  }
}

/** The CSS that shows [material]'s square of the atlas at any size, or undefined. */
export function atlasStyle(atlas: ItemAtlas | null, material: string): CSSProperties | undefined {
  const i = atlas?.index[material.toLowerCase()];
  if (!atlas || i === undefined) return undefined;
  const column = i % ATLAS_COLUMNS;
  const row = Math.floor(i / ATLAS_COLUMNS);
  const percent = (n: number, of: number) => (of > 1 ? (n / (of - 1)) * 100 : 0);
  return {
    backgroundImage: `url("${atlas.url}")`,
    backgroundSize: `${ATLAS_COLUMNS * 100}% ${atlas.rows * 100}%`,
    backgroundPosition: `${percent(column, ATLAS_COLUMNS)}% ${percent(row, atlas.rows)}%`,
    backgroundRepeat: "no-repeat",
  };
}

/** [atlasStyle] for a tile, updated when the atlas arrives. */
export function useAtlasStyle(material: string): CSSProperties | undefined {
  const atlas = useTextureStore((s) => s.atlas);
  return atlasStyle(atlas, material);
}
