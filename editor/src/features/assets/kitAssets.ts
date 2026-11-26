import type { Asset } from "@/domain/asset";
import { API_URL } from "@/lib/api/client";
import { diskAssetsFromTree, followsRamps } from "@/lib/pack/diskAssets";
import {
  type ElsewhereWhere,
  type Reach,
  commonHolders,
  isWrittenName,
  reachOf,
} from "@/lib/pack/elsewhere";
import {
  KIT_ASCENT,
  KIT_FOLDER,
  KIT_PREFIX,
  KIT_SLOTS,
  type KitSlot,
  assetNamesIn,
  commonImageRef,
  imageNamed,
  kitNameOf,
  moduleImageKey,
} from "@/lib/pack/kit";
import { kitImageUrl } from "@/lib/pack/kitUrls";
import type { KitTheme, ThemeLook } from "@/lib/pack/theme";
import { type KitRead, type ModuleRead, useKitStore } from "@/state/kitStore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parse } from "yaml";
import { create } from "zustand";
import { assetBytes } from "./assetBytes";
import { useAssetStore } from "./assetStore";
import { composedView, toDataUrl } from "./composedAssets";
import { activeKitTheme, serverTheme } from "./kitTheme";
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
  /** The image says it follows the ramps: the themes' colours repaint it. */
  ramps?: boolean;
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
      ...(followsRamps(descriptor) ? { ramps: true } : {}),
    });
  }
  return out;
}

/** `ramps`: the image follows the ramps, as the base's do and the server's own when they say so. */
function kitAsset(
  name: string,
  width: number,
  height: number,
  url: string,
  hash: string,
  ramps: boolean,
): Asset {
  return {
    ...(ramps ? { ramps: true } : {}),
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
  theme: ThemeLook | null = null,
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
      (name) =>
        disk.some(
          (a) => !a.compose && a.row.type !== "font" && a.row.name === name && a.row.ramps === true,
        ),
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
  /** The themes `images` and `themed` were made in, and the server's themes they were read from. */
  themes: readonly string[];
  own: unknown;
  /** The kit module's composed images. */
  images: Map<string, OwnImage>;
  /** Every kit image in the themes, when the server has some in place. */
  themed: Asset[] | null;
}
/** What the last kit module read shows, kept until another read or other themes replace it. */
const useShownKit = create<ShownKit>(() => ({
  read: undefined,
  themes: [],
  own: undefined,
  images: NONE,
  themed: null,
}));
let showing: { read: KitRead; themes: readonly string[]; own: unknown } | undefined;

/**
 * The kit images `assets` as the theme shows them (`lib/pack/theme.ts`), like the pack: the
 * theme's own drawing of an image, else the image in the theme's colours; one assembled from
 * themed layers already (`composed`) is only replaced by the theme's drawing of it.
 */
export async function themedKitAssets(
  assets: Asset[],
  composed: Map<string, OwnImage>,
  theme: ThemeLook,
): Promise<Asset[]> {
  return Promise.all(
    assets.map(async (asset) => {
      const name = kitNameOf(asset.id);
      if (name === null) return asset;
      try {
        const png = await assetBytes(asset);
        const assembled = composed.get(name)?.url === asset.previewUrl;
        const shown = assembled
          ? ((await theme.drawing(name, png, false)) ?? png)
          : await theme.shown(name, png, asset.ramps === true);
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
      ? kitAsset(slot.id, slot.width, slot.height, mine.url, mine.hash, mine.ramps === true)
      : kitAsset(slot.id, slot.width, slot.height, kitImageUrl(slot.id) ?? "", "", true);
  });
  const slots = new Set(KIT_SLOTS.map((s) => s.id));
  const others = [...own]
    .filter(([name]) => !slots.has(name))
    .map(([name, image]) =>
      kitAsset(
        name,
        image.width ?? 0,
        image.height ?? 0,
        image.url,
        image.hash,
        image.ramps === true,
      ),
    );
  return [...base, ...others];
}

/** The size of a server's image that is not taken for a piece of the base. */
export interface KitMisfit {
  width: number;
  height: number;
}

/**
 * The pieces of the base the server holds an image of at another size than the piece's, by
 * name, with that image's size (ADR `common-images-and-themes`, decision 4): it is not taken,
 * the base's shows, and the editor says so on the image.
 */
export function kitMisfits(read: KitRead | undefined): Map<string, KitMisfit> {
  const out = new Map<string, KitMisfit>();
  const own = ownImages(read);
  for (const slot of KIT_SLOTS) {
    const mine = own.get(slot.id);
    if (!mine) continue;
    const width = mine.width ?? slot.width;
    const height = mine.height ?? slot.height;
    if (width !== slot.width || height !== slot.height) out.set(slot.id, { width, height });
  }
  return out;
}

/** `kitMisfits` of the server being edited, as published. */
export function useKitMisfits(): Map<string, KitMisfit> {
  const read = useKitStore((s) => s.read);
  return useMemo(() => kitMisfits(read), [read]);
}

/** The base alone, for a list to choose from. */
export const isKitBase = (asset: Asset): boolean =>
  KIT_SLOTS.some((slot) => KIT_PREFIX + slot.id === asset.id);

/**
 * The kit images of the server being edited (published state, from the server index), in the
 * themes its pack is built in: what a player sees for `kit:<name>`.
 */
export function useKitAssets(): Asset[] {
  const read = useKitStore((s) => s.read);
  const themes = useKitStore((s) => s.themes);
  const own = useKitStore((s) => s.own);
  const shown = useShownKit();
  const current = shown.read === read && shown.themes === themes && shown.own === own;
  useEffect(() => {
    if (
      !read ||
      current ||
      (showing?.read === read && showing.themes === themes && showing.own === own)
    )
      return;
    const mine = { read, themes, own };
    showing = mine;
    const inTheme = activeKitTheme(readPublishedBinary);
    void composedKitImages(read, inTheme)
      .then(async (images) => ({
        images,
        themed: inTheme ? await themedKitAssets(kitAssetsOf(read, images), images, inTheme) : null,
      }))
      .then(({ images, themed }) => {
        if (showing === mine) useShownKit.setState({ read, themes, own, images, themed });
      });
  }, [read, themes, own, current]);
  const composed = current ? shown.images : NONE;
  const themed = current ? shown.themed : null;
  return useMemo(() => themed ?? kitAssetsOf(read, composed), [read, composed, themed]);
}

/**
 * The theme `name` of the server as published: the Project of that name among `own`, else the
 * folder its common images' Project `read` keeps; `null` when it holds none of that name.
 */
export const publishedKitTheme = (
  read: KitRead | undefined,
  name: string,
  own: Readonly<Record<string, KitRead>> = {},
): KitTheme | null => serverTheme(read, own, name, readPublishedBinary);

/**
 * The server's kit images in its theme `name` alone, whatever themes its pack is built in;
 * `null`: in no theme. What a theme is judged on before it is put in place.
 */
export function useKitAssetsIn(
  name: string | null,
  /** The theme's table as it is being changed, not written yet: the theme is shown with it. */
  colors: ReadonlyMap<number, number> | null = null,
): Asset[] {
  const read = useKitStore((s) => s.read);
  const own = useKitStore((s) => s.own);
  const [shown, setShown] = useState<{
    read: KitRead;
    name: string | null;
    colors: ReadonlyMap<number, number> | null;
    assets: Asset[];
  } | null>(null);
  useEffect(() => {
    if (!read) return;
    let cancelled = false;
    const published = name === null ? null : publishedKitTheme(read, name, own);
    const theme = published && colors ? published.withColors(colors) : published;
    void composedKitImages(read, theme)
      .then((images) => {
        const plain = kitAssetsOf(read, images);
        return theme ? themedKitAssets(plain, images, theme) : plain;
      })
      .then((assets) => {
        if (!cancelled) setShown({ read, name, colors, assets });
      });
    return () => {
      cancelled = true;
    };
  }, [read, own, name, colors]);
  const plain = useMemo(() => kitAssetsOf(read), [read]);
  // While another table is being read, the last one stays: the menu does not blink to the base.
  return shown && shown.read === read && shown.name === name ? shown.assets : plain;
}

/**
 * What a menu of `projectId` writes for the common image `asset` (`commonImageRef`): its name
 * alone, unless the module holds an image of that name, deployed or not. On a server older
 * than the theme `artisan`, `kit:<name>`: the only spelling it reads.
 */
export function useCommonImageRef(projectId: string): (asset: Asset) => string {
  const byName = useKitStore((s) => s.read?.byName === true);
  const own = useAssetStore((s) => s.assets);
  return useCallback(
    (asset: Asset) => {
      const name = kitNameOf(asset.id);
      if (name === null || !byName) return asset.id;
      return commonImageRef(name, (n) => own.some((a) => a.projectId === projectId && a.id === n));
    },
    [byName, own, projectId],
  );
}

const pathsOf = (held: KitRead) => [
  ...held.binaries.map((b) => b.path),
  ...Object.keys(held.files),
];

interface HeldByModule {
  /** The names the pack reads in the module: its images, composed ones and fonts. */
  names: Set<string>;
  /** Its PNGs as assets, by name, each under its key (`<folder>:<name>`). */
  images: Map<string, Asset>;
}
const heldByModule = new WeakMap<ModuleRead, HeldByModule>();

/**
 * What a module of the server holds, as published: its own files over the ones it ships
 * (`originals/`), like the pack. A composed image has a name and no asset here: it is not
 * assembled for another module's menu.
 */
function heldBy(read: ModuleRead): HeldByModule {
  let held = heldByModule.get(read);
  if (held) return held;
  held = {
    names: new Set(assetNamesIn(pathsOf(read))),
    images: publishedImages(read, read.folder, true),
  };
  heldByModule.set(read, held);
  return held;
}

/**
 * The PNGs of the Project `read` as assets, by name, each under `<folder>:<name>`, drawn from
 * its published file. `originals`: what it ships counts (a module's, not a theme's).
 */
function publishedImages(read: KitRead, folder: string, originals: boolean): Map<string, Asset> {
  const images = new Map<string, Asset>();
  const project = encodeURIComponent(read.projectId);
  const files = Object.entries(read.files).map(([path, content]) => ({ path, content }));
  const binaries = read.binaries.map((b) => ({ ...b, size: 0 }));
  for (const { row, path, hash, compose } of diskAssetsFromTree(read.projectId, files, binaries, {
    originals,
  })) {
    if (compose || (row.type !== "glyph" && row.type !== "texture")) continue;
    // The first of a name keeps it, as in the pack (`ImageNames.themeOwn`).
    if (!originals && images.has(row.name)) continue;
    const key = moduleImageKey(folder, row.name);
    images.set(row.name, {
      ...(row.ramps ? { ramps: true } : {}),
      ...(originals ? {} : { qualifiedOnly: true }),
      id: key,
      projectId: read.projectId,
      type: row.type,
      name: key,
      usages: row.usages,
      width: row.width,
      height: row.height,
      ascent: row.ascent,
      codepoint: row.codepoint,
      fontMeta: null,
      contentHash: hash,
      createdAt: "",
      updatedAt: "",
      previewUrl: `${API_URL}/api/v1/projects/${project}/binary?path=${encodeURIComponent(path)}&h=${hash}`,
    });
  }
  return images;
}

const heldByTheme = new WeakMap<KitRead, Map<string, Asset>>();

/**
 * A theme's own images (`assets/` of its Project, decision 5) as published, by name, each
 * under `<theme>:<name>`: shown as its file is, like the pack.
 */
function themeImages(folder: string, read: KitRead): Map<string, Asset> {
  let images = heldByTheme.get(read);
  if (!images) {
    images = publishedImages(read, folder, false);
    heldByTheme.set(read, images);
  }
  return images;
}

type OwnThemes = Readonly<Record<string, KitRead>>;
const NO_IMAGES: Asset[] = [];

/**
 * The own images of every theme of the server as published, by theme then by name: what a
 * menu may name `<theme>:<image>`. None on a server whose common images are not the theme
 * `artisan`, where no name is read by that rule.
 */
export function useThemesOwnImages(): Asset[] {
  const byName = useKitStore((s) => s.read?.byName === true);
  const themes = useKitStore((s) => s.own);
  const modules = useKitStore((s) => s.modules);
  return useMemo(() => {
    if (!byName) return NO_IMAGES;
    const images = themesBeside(themes, modules).flatMap(([folder, read]) =>
      [...themeImages(folder, read).values()].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
    );
    return images.length === 0 ? NO_IMAGES : images;
  }, [byName, themes, modules]);
}

/**
 * The own images of the theme `name` as published, by name: what a menu writes
 * `<name>:<image>` for. None for a theme the common images' Project keeps (no folder of its
 * own), nor for one whose folder is a module's.
 */
export function useThemeOwnImages(name: string): Asset[] {
  const read = useKitStore((s) => s.own[name]);
  const taken = useKitStore((s) => s.modules.some((m) => m.folder === name));
  return useMemo(() => {
    if (!read || taken) return NO_IMAGES;
    return [...themeImages(name, read).values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
  }, [name, read, taken]);
}

/** The themes whose own images a menu names: a theme of a module's folder gives none. */
function themesBeside(themes: OwnThemes, modules: readonly ModuleRead[]): [string, KitRead][] {
  const folders = new Set(modules.map((m) => m.folder));
  return Object.entries(themes)
    .filter(([folder]) => !folders.has(folder))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

let lastHolders:
  | {
      kit: KitRead;
      modules: readonly ModuleRead[];
      themes: OwnThemes;
      assets: readonly Asset[];
      projectId: string;
      where: ElsewhereWhere;
    }
  | undefined;

/**
 * Who holds which image for the names a menu of `projectId` writes (`reachOf`): the module's
 * own as the editor holds them (`assets`), the common images, the other modules and the
 * themes' own images as published. `null` on a server whose common images are not the theme `artisan`, or not read
 * yet: a name alone is not read by this rule there. Kept for the last call: every image of a
 * menu asks with the same arguments.
 */
function holdersOf(
  kit: KitRead | undefined,
  modules: readonly ModuleRead[],
  themes: OwnThemes,
  assets: readonly Asset[],
  projectId: string,
): ElsewhereWhere | null {
  if (!kit?.byName) return null;
  if (
    lastHolders &&
    lastHolders.kit === kit &&
    lastHolders.modules === modules &&
    lastHolders.themes === themes &&
    lastHolders.assets === assets &&
    lastHolders.projectId === projectId
  )
    return lastHolders.where;
  const own = new Set(assets.filter((a) => a.projectId === projectId).map((a) => a.id));
  const where: ElsewhereWhere = {
    folder: modules.find((m) => m.projectId === projectId)?.folder ?? projectId,
    own: (name) => own.has(name),
    ...commonHolders(pathsOf(kit)),
    modules: modules
      .filter((m) => m.projectId !== projectId)
      .map((m) => ({ folder: m.folder, own: (name: string) => heldBy(m).names.has(name) })),
    themes: themesBeside(themes, modules).map(([folder, read]) => ({
      folder,
      own: (name: string) => themeImages(folder, read).has(name),
    })),
  };
  lastHolders = { kit, modules, themes, assets, projectId, where };
  return where;
}

/**
 * What a name written in a menu of `projectId` reaches (`reachOf`): the module's own image,
 * a common one, another module's, a theme's own, or none. `null`: not known, on a server that does not read
 * a name by this rule (`holdersOf`) or one of whose modules could not be read, and for a name
 * the game fills in (`isWrittenName`).
 */
export function useImageReach(projectId: string): (ref: string) => Reach | null {
  const kit = useKitStore((s) => s.read);
  const modules = useKitStore((s) => s.modules);
  const unread = useKitStore((s) => s.modulesUnread);
  const themes = useKitStore((s) => s.own);
  const assets = useAssetStore((s) => s.assets);
  const where = unread ? null : holdersOf(kit, modules, themes, assets, projectId);
  return useMemo(
    () => (ref: string) => (where && isWrittenName(ref) ? reachOf(ref, where) : null),
    [where],
  );
}

/** The images of the server's modules other than `projectId`, each under its key, in the pack's order. */
function otherImages(modules: readonly ModuleRead[], projectId: string | undefined): Asset[] {
  return modules
    .filter((m) => m.projectId !== projectId)
    .flatMap((m) => [...heldBy(m).images.values()]);
}

/**
 * The module's assets, the common images, the other modules' images and the themes' own: what
 * a title layer's image is looked up in (`imageNamed`).
 */
export function useAssetsWithKit(): Asset[] {
  const own = useAssetStore((s) => s.assets);
  const kit = useKitAssets();
  const modules = useKitStore((s) => s.modules);
  const themes = useKitStore((s) => s.own);
  return useMemo(
    () => [
      ...own,
      ...kit,
      ...otherImages(modules, own[0]?.projectId),
      ...themesBeside(themes, modules).flatMap(([folder, read]) => [
        ...themeImages(folder, read).values(),
      ]),
    ],
    [own, kit, modules, themes],
  );
}

/**
 * The image a menu of `projectId` names, by the pack's rule (`reachOf`): one of its own, else
 * the common image of that name, else another module's; `artisan:<name>` or `kit:<name>` is
 * the common one whatever the module holds, `<folder>:<name>` the image of that module, or a
 * theme's own (`<theme>:<name>`).
 */
export function useImageAsset(projectId: string, name: string | undefined): Asset | undefined {
  const assets = useAssetStore((s) => s.assets);
  const kit = useKitAssets();
  const read = useKitStore((s) => s.read);
  const modules = useKitStore((s) => s.modules);
  const themes = useKitStore((s) => s.own);
  return useMemo(() => {
    if (!name) return undefined;
    const mine = (id: string) => assets.find((a) => a.projectId === projectId && a.id === id);
    const where = holdersOf(read, modules, themes, assets, projectId);
    if (!where) {
      // An older server: the module's own, the common one, then another module's of that name.
      const own = kitNameOf(name) === null ? mine(name) : undefined;
      return own ?? imageNamed([...kit, ...otherImages(modules, projectId)], name);
    }
    const reach = reachOf(name, where);
    if (reach.kind === "own") return mine(name.slice(name.indexOf(":") + 1));
    if (reach.kind === "module") {
      const holder = modules.find((m) => m.folder === reach.folder && m.projectId !== projectId);
      return holder && heldBy(holder).images.get(reach.name);
    }
    if (reach.kind === "theme") {
      const theme = themes[reach.folder];
      return theme && themeImages(reach.folder, theme).get(reach.name);
    }
    return imageNamed(kit, name);
  }, [assets, kit, read, modules, themes, projectId, name]);
}
