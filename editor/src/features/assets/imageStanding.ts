import type { Asset } from "@/domain/asset";
import { API_URL } from "@/lib/api/client";
import { assetDiskPath } from "@/lib/pack/assetDiskWrite";
import { composeRecipe } from "@/lib/pack/compose";
import { yamlStem } from "@/lib/yamlFiles";
import {
  type ImageFunction,
  type ImageOverOriginal,
  type PixelSize,
  imagesOverOriginals,
  measuredPaths,
  refusedImages,
} from "@/lib/pack/imageFunction";
import type { ProjectId } from "@/domain/types";
import { type FileOrigin, fetchProjectOrigins } from "@/lib/api/templates";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useKitStore } from "@/state/kitStore";
import { originalChanged } from "@/state/projectTemplatesStore";
import { parse } from "yaml";
import { useEffect, useMemo, useRef, useState } from "react";
import { type MeasuredFile, usePixelSizes } from "./pixelSizes";
import { useProjectOrigins } from "./useProjectOrigins";

type BinaryTree = Record<string, { hash: string }>;

/**
 * Where an image of a module stands against what the module ships (ADR
 * `common-images-and-themes`, decision 8): `own` is the owner's file, `original` the one the
 * module ships under `originals/`. Both: the owner drew their version over the original, and
 * deleting theirs gives the original back. `original` alone: the image is the module's as
 * shipped, the owner holds nothing to rename or delete.
 */
export interface ImageStanding {
  own?: string;
  original?: { path: string; hash: string };
}

const ORIGINALS = "originals/";

/** The file of the image `id` among `paths`, in the folder of its type or under `prefix` of it. */
function fileOf(paths: string[], dir: string, id: string): string | undefined {
  return paths.find(
    (p) =>
      p.startsWith(dir) &&
      !p.slice(dir.length).includes("/") &&
      p.slice(dir.length).replace(/\.[^.]+$/, "") === id,
  );
}

export function imageStanding(
  tree: BinaryTree,
  asset: Pick<Asset, "id" | "type" | "compose">,
  /** The module's text files (their paths): where a composed image, which has no PNG, is held. */
  files: Iterable<string> = [],
): ImageStanding {
  if (asset.type === "font") return {};
  const dir = assetDiskPath(asset.type, asset.id).replace(/\/[^/]*$/, "/");
  const paths = Object.keys(tree);
  // A composed image's file is its descriptor: the owner's when it is not under `originals/`.
  const recipe = asset.compose
    ? fileOf(
        [...files].filter((p) => yamlStem(p) !== null),
        dir,
        asset.id,
      )
    : undefined;
  const own = fileOf(paths, dir, asset.id) ?? recipe;
  const original = fileOf(paths, `${ORIGINALS}${dir}`, asset.id);
  return {
    ...(own ? { own } : {}),
    ...(original ? { original: { path: original, hash: tree[original]!.hash } } : {}),
  };
}

/** [imageStanding] of an image of the open module, as its draft holds it, else as published. */
export function useImageStanding(
  projectId: string,
  asset: Pick<Asset, "id" | "type" | "compose"> | null,
): ImageStanding {
  const draft = useProjectDraftStore((s) => s.drafts[projectId]);
  const published = useProjectBaselineStore((s) => s.binaryBaselines[projectId]);
  const publishedFiles = useProjectBaselineStore((s) => s.baselines[projectId]);
  const tree = draft?.binaryTree ?? draft?.binaryBaseline ?? published;
  const files = draft?.tree ?? publishedFiles;
  const id = asset?.id;
  const type = asset?.type;
  const compose = asset?.compose;
  return useMemo(
    () =>
      tree && id && type
        ? imageStanding(tree, { id, type, compose }, files ? Object.keys(files) : [])
        : {},
    [tree, files, id, type, compose],
  );
}

/** The published file of a module's original: the server writes it, a draft never holds another. */
export function originalImageUrl(projectId: string, original: { path: string; hash: string }) {
  return `${API_URL}/api/v1/projects/${encodeURIComponent(projectId)}/binary?path=${encodeURIComponent(original.path)}&h=${original.hash}`;
}

/** The measures a function fixes, as a descriptor states them. */
export interface StatedMeasures {
  width: number;
  height: number;
  ascent: number | null;
}

/** The owner's image that is not taken, with its measures and those of the original it stands over. */
export interface ImageNotTaken {
  function: ImageFunction;
  mine: StatedMeasures;
  original: StatedMeasures;
}

const stated = (meta: Record<string, unknown>): StatedMeasures => {
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const ascent = meta.ascent;
  return {
    width: num(meta.width),
    height: num(meta.height),
    ascent: typeof ascent === "number" && Number.isFinite(ascent) ? ascent : null,
  };
};

type FileList = readonly { path: string; content: string }[];

const statedSize = (meta: Record<string, unknown>): PixelSize | null => {
  const { width, height } = stated(meta);
  return width > 0 && height > 0 ? { width, height } : null;
};

/**
 * The size of a file as descriptors state it, for `refusedImages`: the pack measures a menu or
 * HUD image by its pixels; here by what its descriptor states, an image that states no size
 * being taken as fitting.
 */
function statedSizes(overs: readonly ImageOverOriginal[]): (path: string) => PixelSize | null {
  const sizes = new Map<string, PixelSize | null>();
  for (const over of overs) {
    sizes.set(over.original, statedSize(over.originalMeta));
    sizes.set(over.path, statedSize(over.meta) ?? statedSize(over.originalMeta));
  }
  return (path) => sizes.get(path) ?? null;
}

/**
 * The pixels of a file by its path, read from the file itself (`usePixelSizes`): `undefined`
 * while it is not measured, `null` for a file that is no image.
 */
export type MeasuredPixels = (path: string) => PixelSize | null | undefined;

/**
 * The size of a file for `refusedImages`: its pixels as `measured` read them, which is how the
 * pack measures a menu or HUD image; what the descriptors state ([statedSizes]) for a file not
 * measured yet, or when nothing measures.
 */
function sizesOf(
  overs: readonly ImageOverOriginal[],
  measured?: MeasuredPixels,
): (path: string) => PixelSize | null {
  const fromDescriptors = statedSizes(overs);
  if (!measured) return fromDescriptors;
  return (path) => {
    const pixels = measured(path);
    return pixels === undefined ? fromDescriptors(path) : pixels;
  };
}

const lists = (files: Record<string, string>, binaries: BinaryTree) => ({
  fileList: Object.entries(files).map(([path, content]) => ({ path, content })) as FileList,
  binaryList: Object.keys(binaries).map((path) => ({ path })),
});

/**
 * Whether the owner's image `asset` is left out of the pack: it stands over an original that
 * declares a function, at other measures (`imageFunction.ts`), read as [sizesOf] says. The
 * measures reported are the pixels when `measured` read them.
 */
export function imageNotTaken(
  files: Record<string, string>,
  binaries: BinaryTree,
  asset: Pick<Asset, "id" | "type">,
  measured?: MeasuredPixels,
): ImageNotTaken | null {
  if (asset.type === "font") return null;
  const stem = assetDiskPath(asset.type, asset.id).replace(/\.png$/, "");
  const { fileList, binaryList } = lists(files, binaries);
  const overs = imagesOverOriginals(fileList, binaryList);
  const over = overs.find((image) => image.stem === stem);
  if (!over) return null;
  if (
    !refusedImages(fileList, binaryList, sizesOf(overs, measured)).some(
      (image) => image.stem === stem,
    )
  )
    return null;
  // A glyph is measured by its descriptor; a menu or HUD image by its pixels, when read.
  const pixels = (path: string) => (over.function === "glyph" ? null : (measured?.(path) ?? null));
  return {
    function: over.function,
    mine: { ...stated(over.meta), ...pixels(over.path) },
    original: { ...stated(over.originalMeta), ...pixels(over.original) },
  };
}

/**
 * What a list marks on a module's image: `not_taken`, the pack leaves it out ([imageNotTaken]);
 * `own_version`, the owner's file stands over one the module ships (decision 8);
 * `original_changed`, that original changed since the owner's version, which stays the one
 * shown. An image the pack leaves out says that first.
 */
export type ImageMark = "not_taken" | "original_changed" | "own_version";

/** The stem of the file of an image, which [imageMarks] keys by. */
export const imageStem = (asset: Pick<Asset, "id" | "type">): string =>
  assetDiskPath(asset.type, asset.id).replace(/\.png$/, "");

/**
 * The marks of a module's images, by the stem of their file (`assets/textures/crest`).
 * `origins`: what the server recorded of the module's files (`fetchProjectOrigins`); without
 * them no image is said to have a changed original. `measured`: the files' pixels ([sizesOf]).
 */
export function imageMarks(
  files: Record<string, string>,
  binaries: BinaryTree,
  origins?: Record<string, FileOrigin>,
  measured?: MeasuredPixels,
): Map<string, ImageMark> {
  const stemOf = (path: string) => path.replace(/\.[^./]+$/, "");
  const shipped = new Set(
    Object.keys(binaries)
      .filter((path) => path.startsWith(ORIGINALS))
      .map((path) => stemOf(path.slice(ORIGINALS.length))),
  );
  const marks = new Map<string, ImageMark>();
  if (shipped.size === 0) return marks;
  for (const path of Object.keys(binaries)) {
    const stem = stemOf(path);
    if (path.startsWith(ORIGINALS) || !shipped.has(stem)) continue;
    marks.set(stem, origins && originalChanged(origins, path) ? "original_changed" : "own_version");
  }
  // The owner's composed image of a shipped PNG's name: its file is its descriptor.
  for (const [path, content] of Object.entries(files)) {
    const stem = yamlStem(path);
    if (stem === null || path.startsWith(ORIGINALS) || !shipped.has(stem) || marks.has(stem))
      continue;
    if (!holdsRecipe(content)) continue;
    marks.set(stem, origins && originalChanged(origins, path) ? "original_changed" : "own_version");
  }
  const { fileList, binaryList } = lists(files, binaries);
  const overs = imagesOverOriginals(fileList, binaryList);
  for (const image of refusedImages(fileList, binaryList, sizesOf(overs, measured)))
    marks.set(image.stem, "not_taken");
  return marks;
}

/** Whether a descriptor holds a recipe the pack reads (`compose:`). */
function holdsRecipe(content: string): boolean {
  try {
    const value = parse(content);
    return !!value && typeof value === "object" && !Array.isArray(value) && !!composeRecipe(value);
  } catch {
    return false;
  }
}

const NO_FILES: readonly MeasuredFile[] = [];

/** The files of a module whose pixels the rule asks for (`measuredPaths`), to be measured. */
function filesToMeasure(
  projectId: string,
  files: Record<string, string> | undefined,
  binaries: BinaryTree | undefined,
  published = false,
): readonly MeasuredFile[] {
  if (!files || !binaries) return NO_FILES;
  const { fileList, binaryList } = lists(files, binaries);
  const wanted = measuredPaths(fileList, binaryList).flatMap((path) => {
    const hash = binaries[path]?.hash;
    return hash ? [{ projectId, path, hash, published }] : [];
  });
  return wanted.length === 0 ? NO_FILES : wanted;
}

/** The pixels of the files of the open module a function measures, as its draft holds them. */
function useMeasuredPixels(
  projectId: string,
  files: Record<string, string> | undefined,
  binaries: BinaryTree | undefined,
): MeasuredPixels {
  const wanted = useMemo(
    () => filesToMeasure(projectId, files, binaries),
    [projectId, files, binaries],
  );
  const sizeOf = usePixelSizes(wanted);
  return useMemo(
    () => (path: string) => {
      const hash = binaries?.[path]?.hash;
      return hash ? sizeOf(hash) : undefined;
    },
    [binaries, sizeOf],
  );
}

/**
 * [imageMarks] of the open module, as its draft holds it, else as published: the mark of an
 * image. The origins are read from the server when the module holds a version of its own
 * over an original, and only then.
 */
export function useImageMarks(
  projectId: string,
): (asset: Pick<Asset, "id" | "type">) => ImageMark | null {
  const draft = useProjectDraftStore((s) => s.drafts[projectId]);
  const publishedFiles = useProjectBaselineStore((s) => s.baselines[projectId]);
  const publishedBinaries = useProjectBaselineStore((s) => s.binaryBaselines[projectId]);
  const files = draft?.tree ?? publishedFiles;
  const binaries = draft?.binaryTree ?? draft?.binaryBaseline ?? publishedBinaries;
  const measured = useMeasuredPixels(projectId, files, binaries);
  const plain = useMemo(
    () =>
      files && binaries
        ? imageMarks(files, binaries, undefined, measured)
        : new Map<string, ImageMark>(),
    [files, binaries, measured],
  );
  const origins = useProjectOrigins(projectId as ProjectId, plain.size > 0).entry?.origins;
  return useMemo(() => {
    const marks =
      files && binaries && origins ? imageMarks(files, binaries, origins, measured) : plain;
    return (asset) => (asset.type === "font" ? null : (marks.get(imageStem(asset)) ?? null));
  }, [files, binaries, origins, plain, measured]);
}

/** [imageNotTaken] of an image of the open module, as its draft holds it, else as published. */
export function useImageNotTaken(
  projectId: string,
  asset: Pick<Asset, "id" | "type"> | null,
): ImageNotTaken | null {
  const draft = useProjectDraftStore((s) => s.drafts[projectId]);
  const publishedFiles = useProjectBaselineStore((s) => s.baselines[projectId]);
  const publishedBinaries = useProjectBaselineStore((s) => s.binaryBaselines[projectId]);
  const files = draft?.tree ?? publishedFiles;
  const binaries = draft?.binaryTree ?? draft?.binaryBaseline ?? publishedBinaries;
  const measured = useMeasuredPixels(projectId, files, binaries);
  const id = asset?.id;
  const type = asset?.type;
  return useMemo(
    () =>
      files && binaries && id && type
        ? imageNotTaken(files, binaries, { id, type }, measured)
        : null,
    [files, binaries, id, type, measured],
  );
}

/**
 * Whether the owner holds the file of `asset` in the module (`binaries`, `files`: its paths),
 * and not only what the module ships under `originals/`: an image by its PNG, a font by its
 * folder.
 */
export function ownerHolds(paths: Iterable<string>, asset: Pick<Asset, "id" | "type">): boolean {
  const stem = imageStem(asset);
  for (const path of paths) {
    if (asset.type === "font" ? path.startsWith(`${stem}/`) : path === `${stem}.png`) return true;
  }
  return false;
}

/**
 * Which images and fonts of the server's modules, as published (`useKitStore.modules`), are
 * their owner's own files ([ownerHolds]): the ones the server's Resources offer to copy to
 * the common images.
 */
export function useServerOwnerHolds(): (
  asset: Pick<Asset, "id" | "type" | "projectId">,
) => boolean {
  const modules = useKitStore((s) => s.modules);
  return useMemo(() => {
    const paths = new Map(
      modules.map((m) => [
        m.projectId as string,
        [...Object.keys(m.files), ...m.binaries.map((b) => b.path)],
      ]),
    );
    return (asset) => ownerHolds(paths.get(asset.projectId) ?? [], asset);
  }, [modules]);
}

/**
 * The marks of the images of the server's modules as published (`useKitStore.modules`), for
 * the server's Resources: by Project id, then by stem. The origins of a module are asked of
 * its server once, when it holds a version of its own over an original; a module that cannot
 * be asked (its server is off) keeps its other marks.
 */
export function useServerImageMarks(
  projectIds: readonly string[],
): (asset: Pick<Asset, "id" | "type" | "projectId">) => ImageMark | null {
  const modules = useKitStore((s) => s.modules);
  const [origins, setOrigins] = useState<Record<string, Record<string, FileOrigin>>>({});
  const shown = useMemo(() => {
    const ids = new Set(projectIds);
    return modules
      .filter((m) => ids.has(m.projectId))
      .map((m) => ({
        id: m.projectId,
        read: m,
        files: m.files,
        binaries: Object.fromEntries(m.binaries.map((b) => [b.path, { hash: b.hash }])),
      }));
  }, [modules, projectIds]);
  // Measured as published: a draft of a module is not what the server's list shows.
  const wanted = useMemo(
    () => shown.flatMap((m) => filesToMeasure(m.id, m.files, m.binaries, true)),
    [shown],
  );
  const sizeOf = usePixelSizes(wanted);
  const measuredIn = useMemo(
    () => (binaries: BinaryTree) => (path: string) => {
      const hash = binaries[path]?.hash;
      return hash ? sizeOf(hash) : undefined;
    },
    [sizeOf],
  );
  const plain = useMemo(
    () =>
      new Map(
        shown.map(
          (m) =>
            [m.id, imageMarks(m.files, m.binaries, undefined, measuredIn(m.binaries))] as const,
        ),
      ),
    [shown, measuredIn],
  );
  // Asked again when the module is read again: a deploy or an update may have changed them.
  const asked = useRef(new WeakSet<object>());
  useEffect(() => {
    for (const { id, read } of shown) {
      if (!plain.get(id)?.size || asked.current.has(read)) continue;
      asked.current.add(read);
      void fetchProjectOrigins(id).then((answer) => {
        if (answer.ok) setOrigins((held) => ({ ...held, [id]: answer.origins }));
      });
    }
  }, [shown, plain]);
  return useMemo(() => {
    const marks = new Map(
      shown.map((m) => {
        const read = origins[m.id];
        return [
          m.id,
          read ? imageMarks(m.files, m.binaries, read, measuredIn(m.binaries)) : plain.get(m.id),
        ] as const;
      }),
    );
    return (asset) =>
      asset.type === "font" ? null : (marks.get(asset.projectId)?.get(imageStem(asset)) ?? null);
  }, [shown, origins, plain, measuredIn]);
}
