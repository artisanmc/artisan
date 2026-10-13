import type { Asset } from "@/domain/asset";
import { assetDiskPath } from "@/lib/pack/assetDiskWrite";
import { FONT_DIR } from "@/lib/pack/fontOnDisk";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";

const API_URL = import.meta.env.VITE_API_URL ?? "";
type BinaryTree = Record<string, { hash: string; size: number }>;

/**
 * Aperçus de l'éditeur auto-hébergé, servis par des routes que le plugin connaît
 * déjà : le blob du brouillon quand l'image y a changé, sinon le fichier publié.
 * Même octets que `GET /api/v1/textures/asset…` du backend, sans le résoudre côté serveur.
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

/** Le PNG d'une texture ou d'un glyphe : son chemin réel dans l'arbre, à défaut le chemin canonique. */
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

/** Un glyphe d'une police dépliée : `assets/fonts/<police>/<texture>`. */
export function localFontGlyphUrl(asset: Asset, texture: string): string {
  const { published, draft } = trees(asset.projectId, asset.draftId);
  const path = `${FONT_DIR}/${asset.id}/${texture}`;
  return fileUrl(asset, path, (draft ?? published)[path]?.hash, published);
}
