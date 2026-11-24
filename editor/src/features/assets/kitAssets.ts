import type { Asset } from "@/domain/asset";
import { API_URL } from "@/lib/api/client";
import {
  KIT_ASCENT,
  KIT_FOLDER,
  KIT_PREFIX,
  KIT_SLOTS,
  type KitSlot,
  kitNameOf,
} from "@/lib/pack/kit";
import { diskAssetsFromTree } from "@/lib/pack/diskAssets";
import { kitImageUrl } from "@/lib/pack/kitUrls";
import { type KitRead, useKitStore } from "@/state/kitStore";
import { useEffect, useMemo } from "react";
import { parse } from "yaml";
import { create } from "zustand";
import { useAssetStore } from "./assetStore";
import { composedView } from "./composedAssets";
import { readPublishedBinary } from "./localAssets";

/**
 * The UI kit as the editor shows it (`lib/pack/kit.ts`): what a menu names `kit:<name>`. Each
 * image is an `Asset` whose id is that reference, so a menu's canvas and inspector draw it like
 * one of the module's own; it is not a file of the module being edited, and is never copied
 * into it.
 */

const IMAGE_DIRS = ["assets/glyphs/", "assets/textures/"];

interface OwnImage {
  url: string;
  hash: string;
  width: number | null;
  height: number | null;
}

const size = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** The kit module's images by name, as it has them published. */
function ownImages(read: KitRead | undefined): Map<string, OwnImage> {
  const out = new Map<string, OwnImage>();
  if (!read) return out;
  const project = encodeURIComponent(read.projectId);
  // By path, as the pack reads them: a texture after a glyph of the same name, so it wins.
  const binaries = [...read.binaries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  for (const { path, hash } of binaries) {
    const dir = IMAGE_DIRS.find((d) => path.startsWith(d) && !path.slice(d.length).includes("/"));
    if (!dir || !path.endsWith(".png")) continue;
    const stem = path.slice(0, -".png".length);
    let descriptor: Record<string, unknown> | null = null;
    try {
      descriptor = parse(read.files[`${stem}.yml`] ?? read.files[`${stem}.yaml`] ?? "") ?? null;
    } catch {
      // An unreadable descriptor says nothing of the size.
    }
    out.set(stem.slice(dir.length), {
      url: `${API_URL}/api/v1/projects/${project}/binary?path=${encodeURIComponent(path)}&h=${hash}`,
      hash,
      width: size(descriptor?.width),
      height: size(descriptor?.height),
    });
  }
  return out;
}

function kitAsset(name: string, width: number, height: number, url: string, hash: string): Asset {
  return {
    id: KIT_PREFIX + name,
    projectId: KIT_FOLDER,
    type: "texture",
    name: KIT_PREFIX + name,
    usages: ["button", "menu"],
    width,
    height,
    ascent: KIT_ASCENT,
    codepoint: null,
    fontMeta: null,
    contentHash: hash,
    createdAt: "",
    updatedAt: "",
    previewUrl: url,
  };
}

/**
 * The kit module's composed images by name (`lib/pack/compose.ts`), assembled as the pack does
 * it: each over the module's PNGs and the base, never over another composed image.
 */
export async function composedKitImages(read: KitRead): Promise<Map<string, OwnImage>> {
  const files = Object.entries(read.files).map(([path, content]) => ({ path, content }));
  const disk = diskAssetsFromTree(
    read.projectId,
    files,
    read.binaries.map((b) => ({ ...b, size: 0 })),
  );
  const bytes = new Map<string, Promise<Uint8Array | null>>();
  const png = (path: string) => {
    if (!bytes.has(path))
      bytes.set(
        path,
        readPublishedBinary(read.projectId, path).catch(() => null),
      );
    return bytes.get(path)!;
  };
  const out = new Map<string, OwnImage>();
  for (const asset of disk) {
    if (!asset.compose) continue;
    const view = await composedView(
      asset,
      disk,
      (layer) => png(layer.path),
      (name) => {
        const own = disk.find((a) => !a.compose && a.row.type !== "font" && a.row.name === name);
        return own ? png(own.path) : undefined;
      },
    ).catch(() => null);
    if (view?.previewUrl)
      out.set(asset.row.name, {
        url: view.previewUrl,
        hash: asset.hash,
        width: view.width,
        height: view.height,
      });
  }
  return out;
}

const NONE = new Map<string, OwnImage>();
/** The composed images of the last kit module read, kept until another read replaces it. */
const useComposedKit = create<{ read: KitRead | undefined; images: Map<string, OwnImage> }>(() => ({
  read: undefined,
  images: NONE,
}));
let composing: KitRead | undefined;

/**
 * Every kit image of a server: the base first, in its order (the kit module's image where it
 * has one of the slot's size, as its descriptor says; Artisan's otherwise), then the kit
 * module's other images. `composed`: its composed images, which a PNG of the same name hides.
 */
export function kitAssetsOf(
  read: KitRead | undefined,
  composed: Map<string, OwnImage> = NONE,
): Asset[] {
  const own = ownImages(read);
  for (const [name, image] of composed) if (!own.has(name)) own.set(name, image);
  const fits = (slot: KitSlot, image: OwnImage) =>
    (image.width ?? slot.width) === slot.width && (image.height ?? slot.height) === slot.height;
  const base = KIT_SLOTS.map((slot) => {
    const mine = own.get(slot.id);
    return mine && fits(slot, mine)
      ? kitAsset(slot.id, slot.width, slot.height, mine.url, mine.hash)
      : kitAsset(slot.id, slot.width, slot.height, kitImageUrl(slot.id) ?? "", "");
  });
  const slots = new Set(KIT_SLOTS.map((s) => s.id));
  const others = [...own]
    .filter(([name]) => !slots.has(name))
    .map(([name, image]) =>
      kitAsset(name, image.width ?? 0, image.height ?? 0, image.url, image.hash),
    );
  return [...base, ...others];
}

/** The base alone, for a list to choose from. */
export const isKitBase = (asset: Asset): boolean =>
  KIT_SLOTS.some((slot) => KIT_PREFIX + slot.id === asset.id);

/** The kit images of the server being edited (published state, from the server index). */
export function useKitAssets(): Asset[] {
  const read = useKitStore((s) => s.read);
  const composed = useComposedKit((s) => (s.read === read ? s.images : NONE));
  useEffect(() => {
    if (!read || composing === read || useComposedKit.getState().read === read) return;
    composing = read;
    void composedKitImages(read).then((images) => {
      if (composing === read) useComposedKit.setState({ read, images });
    });
  }, [read]);
  return useMemo(() => kitAssetsOf(read, composed), [read, composed]);
}

/** The module's assets and the kit's: what a title layer's image is looked up in. */
export function useAssetsWithKit(): Asset[] {
  const own = useAssetStore((s) => s.assets);
  const kit = useKitAssets();
  return useMemo(() => [...own, ...kit], [own, kit]);
}

/** The image a menu of `projectId` names: one of its own, or a kit image (`kit:<name>`). */
export function useImageAsset(projectId: string, name: string | undefined): Asset | undefined {
  const isKit = !!name && kitNameOf(name) !== null;
  const own = useAssetStore((s) =>
    name && !isKit ? s.assets.find((a) => a.projectId === projectId && a.id === name) : undefined,
  );
  const kit = useKitAssets();
  return isKit ? kit.find((a) => a.id === name) : own;
}
