import type { Asset } from "@/domain/asset";
import { API_URL } from "@/lib/api/client";
import { assetDiskPath } from "@/lib/pack/assetDiskWrite";
import {
  type ImageFunction,
  type ImageOverOriginal,
  type PixelSize,
  imagesOverOriginals,
  refusedImages,
} from "@/lib/pack/imageFunction";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useMemo } from "react";

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

export function imageStanding(tree: BinaryTree, asset: Pick<Asset, "id" | "type">): ImageStanding {
  if (asset.type === "font") return {};
  const dir = assetDiskPath(asset.type, asset.id).replace(/\/[^/]*$/, "/");
  const paths = Object.keys(tree);
  const own = fileOf(paths, dir, asset.id);
  const original = fileOf(paths, `${ORIGINALS}${dir}`, asset.id);
  return {
    ...(own ? { own } : {}),
    ...(original ? { original: { path: original, hash: tree[original]!.hash } } : {}),
  };
}

/** [imageStanding] of an image of the open module, as its draft holds it, else as published. */
export function useImageStanding(
  projectId: string,
  asset: Pick<Asset, "id" | "type"> | null,
): ImageStanding {
  const draft = useProjectDraftStore((s) => s.drafts[projectId]);
  const published = useProjectBaselineStore((s) => s.binaryBaselines[projectId]);
  const tree = draft?.binaryTree ?? draft?.binaryBaseline ?? published;
  const id = asset?.id;
  const type = asset?.type;
  return useMemo(
    () => (tree && id && type ? imageStanding(tree, { id, type }) : {}),
    [tree, id, type],
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

const lists = (files: Record<string, string>, binaries: BinaryTree) => ({
  fileList: Object.entries(files).map(([path, content]) => ({ path, content })) as FileList,
  binaryList: Object.keys(binaries).map((path) => ({ path })),
});

/**
 * Whether the owner's image `asset` is left out of the pack: it stands over an original that
 * declares a function, at other measures (`imageFunction.ts`), read as [statedSizes] says.
 */
export function imageNotTaken(
  files: Record<string, string>,
  binaries: BinaryTree,
  asset: Pick<Asset, "id" | "type">,
): ImageNotTaken | null {
  if (asset.type === "font") return null;
  const stem = assetDiskPath(asset.type, asset.id).replace(/\.png$/, "");
  const { fileList, binaryList } = lists(files, binaries);
  const overs = imagesOverOriginals(fileList, binaryList);
  const over = overs.find((image) => image.stem === stem);
  if (!over) return null;
  if (!refusedImages(fileList, binaryList, statedSizes(overs)).some((image) => image.stem === stem))
    return null;
  return { function: over.function, mine: stated(over.meta), original: stated(over.originalMeta) };
}

/**
 * What a module's list marks on an image: `not_taken`, the pack leaves it out ([imageNotTaken]);
 * `own_version`, the owner's file stands over one the module ships (decision 8).
 */
export type ImageMark = "not_taken" | "own_version";

/** The marks of a module's images, by the stem of their file (`assets/textures/crest`). */
export function imageMarks(
  files: Record<string, string>,
  binaries: BinaryTree,
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
    if (!path.startsWith(ORIGINALS) && shipped.has(stem)) marks.set(stem, "own_version");
  }
  const { fileList, binaryList } = lists(files, binaries);
  const overs = imagesOverOriginals(fileList, binaryList);
  for (const image of refusedImages(fileList, binaryList, statedSizes(overs)))
    marks.set(image.stem, "not_taken");
  return marks;
}

/** [imageMarks] of the open module, as its draft holds it, else as published: the mark of an image. */
export function useImageMarks(
  projectId: string,
): (asset: Pick<Asset, "id" | "type">) => ImageMark | null {
  const draft = useProjectDraftStore((s) => s.drafts[projectId]);
  const publishedFiles = useProjectBaselineStore((s) => s.baselines[projectId]);
  const publishedBinaries = useProjectBaselineStore((s) => s.binaryBaselines[projectId]);
  const files = draft?.tree ?? publishedFiles;
  const binaries = draft?.binaryTree ?? draft?.binaryBaseline ?? publishedBinaries;
  return useMemo(() => {
    const marks = files && binaries ? imageMarks(files, binaries) : new Map<string, ImageMark>();
    return (asset) =>
      asset.type === "font"
        ? null
        : (marks.get(assetDiskPath(asset.type, asset.id).replace(/\.png$/, "")) ?? null);
  }, [files, binaries]);
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
  const id = asset?.id;
  const type = asset?.type;
  return useMemo(
    () => (files && binaries && id && type ? imageNotTaken(files, binaries, { id, type }) : null),
    [files, binaries, id, type],
  );
}
