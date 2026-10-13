import type { Asset } from "@/domain/asset";
import { assetDiskPath } from "@/lib/pack/assetDiskWrite";
import { FONT_DIR } from "@/lib/pack/fontOnDisk";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";

const API_URL = import.meta.env.VITE_API_URL ?? "";
type BinaryTree = Record<string, { hash: string; size: number }>;

/**
 * Previews for the self-hosted editor, served by routes the plugin already
 * knows: the draft blob when the image changed there, the published file
 * otherwise.
 */
function trees(projectId: string, draftId: string | undefined) {
  const local = useProjectDraftStore.getState().get(projectId);
  const published: BinaryTree =
    local?.binaryBaseline ?? useProjectBaselineStore.getState().binaryBaselines[projectId] ?? {};
  const draft: BinaryTree | undefined =
    draftId && local?.remote?.id === draftId ? local.binaryTree : undefined;
  return { published, draft };
}

function fileUrl(asset: Asset, path: string, hash: string | undefined, published: BinaryTree) {
  const project = encodeURIComponent(asset.projectId);
  if (asset.draftId && hash && published[path]?.hash !== hash)
    return `${API_URL}/api/v1/user/projects/${project}/drafts/${encodeURIComponent(asset.draftId)}/blobs/${hash}`;
  return `${API_URL}/api/v1/projects/${project}/binary?path=${encodeURIComponent(path)}&h=${hash ?? asset.contentHash}`;
}

/** A texture or glyph PNG: its real path in the tree, or the canonical path as a fallback. */
export function localAssetPreviewUrl(asset: Asset): string {
  const { published, draft } = trees(asset.projectId, asset.draftId);
  const dir = assetDiskPath(asset.type, asset.id).replace(/\/[^/]*$/, "/");
  const path =
    Object.keys({ ...published, ...draft }).find(
      (p) =>
        p.startsWith(dir) &&
        !p.slice(dir.length).includes("/") &&
        p.slice(dir.length).replace(/\.[^.]+$/, "") === asset.id,
    ) ?? assetDiskPath(asset.type, asset.id);
  return fileUrl(asset, path, asset.contentHash, published);
}

/** A glyph of an unpacked font: `assets/fonts/<font>/<texture>`. */
export function localFontGlyphUrl(asset: Asset, texture: string): string {
  const { published, draft } = trees(asset.projectId, asset.draftId);
  const path = `${FONT_DIR}/${asset.id}/${texture}`;
  return fileUrl(asset, path, (draft ?? published)[path]?.hash, published);
}
