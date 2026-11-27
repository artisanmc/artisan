import { type Asset, assetPreviewUrl } from "@/domain/asset";
import { type KitRead, useKitStore } from "@/state/kitStore";
import { useEffect, useMemo, useState } from "react";
import { readPublishedBinary } from "./localAssets";
import { moduleImageId, themeModuleAssets } from "./themeModuleImages";

/**
 * What the themes in place draw in place of the modules' own images (ADR
 * `themes-reach-modules`, decision 3), as published: the canvas shows a module's image as the
 * pack builds it, the highest theme's `overrides/<module>/<image>.png` when there is one.
 */

/** A theme's drawing of a module's image: where it is drawn from, and its size. */
export interface ModuleDrawing {
  url: string;
  width: number;
  height: number;
  hash: string;
}

/** The drawings by `<module>/<image>` (`moduleImageId`). */
export type ModuleDrawings = ReadonlyMap<string, ModuleDrawing>;

const NONE: ModuleDrawings = new Map();

/** The size a PNG states in its header; zeros for bytes that are not a PNG. */
export function pngHeaderSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return { width: 0, height: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

type Binary = (projectId: string, path: string) => Promise<Uint8Array | null>;

const held = new WeakMap<KitRead, Promise<Map<string, ModuleDrawing>>>();

/** The drawings one theme holds; a file written by hand has no size beside it: its header says it. */
function drawingsOf(read: KitRead, binary: Binary): Promise<Map<string, ModuleDrawing>> {
  let mine = held.get(read);
  if (!mine) {
    const files = Object.entries(read.files).map(([path, content]) => ({ path, content }));
    mine = Promise.all(
      themeModuleAssets(read.projectId, files, read.binaries).map(async ({ row, path, hash }) => {
        const asset = row as unknown as Asset;
        const size =
          asset.width > 0 && asset.height > 0
            ? { width: asset.width, height: asset.height }
            : await binary(read.projectId, path)
                .then((bytes) => (bytes ? pngHeaderSize(bytes) : { width: 0, height: 0 }))
                .catch(() => ({ width: 0, height: 0 }));
        return [
          moduleImageId(asset.under ?? "", asset.name),
          { url: assetPreviewUrl(asset), hash, ...size },
        ] as const;
      }),
    ).then((entries) => new Map(entries.filter(([, drawing]) => drawing.width > 0)));
    held.set(read, mine);
  }
  return mine;
}

/** The drawings of the themes `names`, from the lowest to the highest: the highest wins. */
export async function moduleDrawings(
  names: readonly string[],
  own: Readonly<Record<string, KitRead>>,
  binary: Binary = readPublishedBinary,
): Promise<ModuleDrawings> {
  const out = new Map<string, ModuleDrawing>();
  for (const name of names) {
    const read = own[name];
    if (!read) continue;
    for (const [id, drawing] of await drawingsOf(read, binary)) out.set(id, drawing);
  }
  return out.size === 0 ? NONE : out;
}

/** `moduleDrawings` of the server being edited, in the themes its pack is built in. */
export function useModuleDrawings(): ModuleDrawings {
  const names = useKitStore((s) => s.themes);
  const own = useKitStore((s) => s.own);
  const [shown, setShown] = useState<{ names: unknown; own: unknown; drawings: ModuleDrawings }>({
    names: null,
    own: null,
    drawings: NONE,
  });
  // No theme in place that holds files: nothing to read.
  const some = useMemo(() => names.some((name) => own[name]), [names, own]);
  useEffect(() => {
    if (!some) return;
    let live = true;
    void moduleDrawings(names, own).then((drawings) => {
      if (live) setShown({ names, own, drawings });
    });
    return () => {
      live = false;
    };
  }, [names, own, some]);
  return some && shown.names === names && shown.own === own ? shown.drawings : NONE;
}

/**
 * The module `module`'s image `asset`, named `name` there, as the themes show it: the theme's
 * file at the theme's size, else itself. A composed image is left as it is, like the pack.
 */
export function drawnInModule(
  asset: Asset,
  module: string | undefined,
  name: string,
  drawings: ModuleDrawings,
): Asset {
  if (!module || asset.compose || drawings.size === 0) return asset;
  const drawing = drawings.get(moduleImageId(module, name));
  if (!drawing) return asset;
  return {
    ...asset,
    previewUrl: drawing.url,
    width: drawing.width,
    height: drawing.height,
    contentHash: drawing.hash,
  };
}

/**
 * `drawnInModule` for the images of the module `projectId`: what a canvas draws one of its own
 * images with. An image of a theme's Project is left as it is.
 */
export function useDrawnInOwnModule(projectId: string): (asset: Asset) => Asset {
  const folder = useKitStore((s) => s.modules.find((m) => m.projectId === projectId)?.folder);
  const drawings = useModuleDrawings();
  return useMemo(
    () => (asset: Asset) =>
      asset.under || asset.projectId !== projectId
        ? asset
        : drawnInModule(asset, folder, asset.name, drawings),
    [projectId, folder, drawings],
  );
}
