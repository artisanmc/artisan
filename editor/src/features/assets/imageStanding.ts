import type { Asset } from "@/domain/asset";
import { API_URL } from "@/lib/api/client";
import { assetDiskPath } from "@/lib/pack/assetDiskWrite";
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
