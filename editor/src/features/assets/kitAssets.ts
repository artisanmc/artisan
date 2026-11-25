import type { Asset } from "@/domain/asset";
import { API_URL } from "@/lib/api/client";
import {
  KIT_ASCENT,
  KIT_FOLDER,
  KIT_PREFIX,
  KIT_SLOTS,
  type KitSlot,
  commonImageRef,
  imageNamed,
  kitNameOf,
} from "@/lib/pack/kit";
import { diskAssetsFromTree } from "@/lib/pack/diskAssets";
import { kitImageUrl } from "@/lib/pack/kitUrls";
import { type KitTheme, readKitTheme } from "@/lib/pack/theme";
import { type KitRead, useKitStore } from "@/state/kitStore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parse } from "yaml";
import { create } from "zustand";
import { assetBytes } from "./assetBytes";
import { useAssetStore } from "./assetStore";
import { composedView, toDataUrl } from "./composedAssets";
import { activeKitTheme } from "./kitTheme";
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
export async function composedKitImages(
  read: KitRead,
  theme: KitTheme | null = null,
): Promise<Map<string, OwnImage>> {
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
      theme,
      true,
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

interface ShownKit {
  read: KitRead | undefined;
  /** The theme `images` and `themed` were made in. */
  theme: string | undefined;
  /** The kit module's composed images. */
  images: Map<string, OwnImage>;
  /** Every kit image in the theme, when the server has one in place. */
  themed: Asset[] | null;
}
/** What the last kit module read shows, kept until another read or another theme replaces it. */
const useShownKit = create<ShownKit>(() => ({
  read: undefined,
  theme: undefined,
  images: NONE,
  themed: null,
}));
let showing: { read: KitRead; theme: string | undefined } | undefined;

/**
 * The kit images `assets` as the theme shows them (`lib/pack/theme.ts`), like the pack: the
 * theme's own drawing of an image, else the image in the theme's colours; one assembled from
 * themed layers already (`composed`) is only replaced by the theme's drawing of it.
 */
export async function themedKitAssets(
  assets: Asset[],
  composed: Map<string, OwnImage>,
  theme: KitTheme,
): Promise<Asset[]> {
  return Promise.all(
    assets.map(async (asset) => {
      const name = kitNameOf(asset.id);
      if (name === null) return asset;
      try {
        const png = await assetBytes(asset);
        const assembled = composed.get(name)?.url === asset.previewUrl;
        const shown = assembled
          ? ((await theme.drawing(name, png)) ?? png)
          : await theme.shown(name, png);
        return shown === png ? asset : { ...asset, previewUrl: toDataUrl(shown) };
      } catch {
        // An image that cannot be read is shown as it was.
        return asset;
      }
    }),
  );
}

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

/**
 * The kit images of the server being edited (published state, from the server index), in the
 * theme its pack is built in: what a player sees for `kit:<name>`.
 */
export function useKitAssets(): Asset[] {
  const read = useKitStore((s) => s.read);
  const theme = useKitStore((s) => s.theme);
  const shown = useShownKit();
  const current = shown.read === read && shown.theme === theme;
  useEffect(() => {
    if (!read || current || (showing?.read === read && showing.theme === theme)) return;
    const mine = { read, theme };
    showing = mine;
    const inTheme = activeKitTheme(readPublishedBinary);
    void composedKitImages(read, inTheme)
      .then(async (images) => ({
        images,
        themed: inTheme ? await themedKitAssets(kitAssetsOf(read, images), images, inTheme) : null,
      }))
      .then(({ images, themed }) => {
        if (showing === mine) useShownKit.setState({ read, theme, images, themed });
      });
  }, [read, theme, current]);
  const composed = current ? shown.images : NONE;
  const themed = current ? shown.themed : null;
  return useMemo(() => themed ?? kitAssetsOf(read, composed), [read, composed, themed]);
}

/** The theme `name` of the published kit module `read`; `null` when it holds none of that name. */
export const publishedKitTheme = (read: KitRead, name: string): KitTheme | null =>
  readKitTheme(name, {
    files: Object.entries(read.files).map(([path, content]) => ({ path, content })),
    binaries: read.binaries,
    binary: (path) => readPublishedBinary(read.projectId, path).catch(() => null),
  });

/**
 * The server's kit images in the theme `name` of its kit module, whatever theme its pack is
 * built in; `null`: in no theme. What a theme is judged on before it is put in place.
 */
export function useKitAssetsIn(name: string | null): Asset[] {
  const read = useKitStore((s) => s.read);
  const [shown, setShown] = useState<{
    read: KitRead;
    name: string | null;
    assets: Asset[];
  } | null>(null);
  useEffect(() => {
    if (!read) return;
    let cancelled = false;
    const theme = name === null ? null : publishedKitTheme(read, name);
    void composedKitImages(read, theme)
      .then((images) => {
        const plain = kitAssetsOf(read, images);
        return theme ? themedKitAssets(plain, images, theme) : plain;
      })
      .then((assets) => {
        if (!cancelled) setShown({ read, name, assets });
      });
    return () => {
      cancelled = true;
    };
  }, [read, name]);
  const plain = useMemo(() => kitAssetsOf(read), [read]);
  return shown && shown.read === read && shown.name === name ? shown.assets : plain;
}

/**
 * What a menu of `projectId` writes for the common image `asset` (`commonImageRef`): its name
 * alone, unless the module being edited or another module of the server holds that name. On a
 * server older than the theme `artisan`, `kit:<name>`: the only spelling it reads.
 */
export function useCommonImageRef(projectId: string): (asset: Asset) => string {
  const byName = useKitStore((s) => s.read?.byName === true);
  const taken = useKitStore((s) => s.taken);
  const own = useAssetStore((s) => s.assets);
  return useCallback(
    (asset: Asset) => {
      const name = kitNameOf(asset.id);
      if (name === null || !byName) return asset.id;
      return commonImageRef(
        name,
        (n) => taken.has(n) || own.some((a) => a.projectId === projectId && a.id === n),
      );
    },
    [byName, taken, own, projectId],
  );
}

/** The module's assets and the kit's: what a title layer's image is looked up in. */
export function useAssetsWithKit(): Asset[] {
  const own = useAssetStore((s) => s.assets);
  const kit = useKitAssets();
  return useMemo(() => [...own, ...kit], [own, kit]);
}

/**
 * The image a menu of `projectId` names: one of its own, else the common image of that name;
 * `artisan:<name>` or `kit:<name>` is the common one whatever the module holds (`imageNamed`).
 */
export function useImageAsset(projectId: string, name: string | undefined): Asset | undefined {
  const isKit = !!name && kitNameOf(name) !== null;
  const own = useAssetStore((s) =>
    name && !isKit ? s.assets.find((a) => a.projectId === projectId && a.id === name) : undefined,
  );
  const kit = useKitAssets();
  return name ? (own ?? imageNamed(kit, name)) : undefined;
}
