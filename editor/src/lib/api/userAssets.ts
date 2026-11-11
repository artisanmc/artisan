import type { Asset, AssetType, AssetUsage } from "@/domain/asset";
import {
  listLocalAssets,
  performLocalAssetMutation,
  readAssetFiles,
  toBase64,
} from "@/features/assets/localAssets";
import {
  type AssetMutation,
  mutateDraftAssets,
  trackDraftAssetPreparation,
} from "@/features/project/persistedDrafts";
import { ApiError, apiFetch, apiRequest, apiUrl } from "@/lib/api/client";
import { watchProjectPrincipal } from "@/lib/projectPrincipal";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import type { PersistedDraft } from "./projectDrafts";

type AssetResponse = { draft: PersistedDraft; asset?: Asset; warnings?: string[] };
type RequestAsset = NonNullable<AssetMutation["asset"]>;
export async function listAssets(
  projectId: string,
  filters: { type?: AssetType; search?: string } = {},
): Promise<Asset[]> {
  const remote = useProjectDraftStore.getState().get(projectId)?.remote;
  const draftId = remote && remote.revision > 0 ? remote.id : undefined;
  // The editor reads the draft's tree or the disk's.
  const assets = await listLocalAssets(projectId, filters, draftId);
  return assets.map((asset) => ({ ...asset, ...(draftId ? { draftId } : {}) }));
}
async function perform(projectId: string, operation: AssetMutation): Promise<AssetResponse> {
  const result = await performLocalAssetMutation(projectId, operation);
  return {
    ...result,
    ...(result.asset ? { asset: { ...result.asset, draftId: operation.id } } : {}),
  };
}
async function mutate(projectId: string, request: RequestAsset) {
  return mutateDraftAssets(projectId, request, (operation) => perform(projectId, operation));
}
export async function resumeAssetMutation(projectId: string): Promise<void> {
  const operation = useProjectDraftStore.getState().get(projectId)?.remote?.pendingMutation;
  if (operation?.kind !== "asset" || !operation.asset) return;
  await mutateDraftAssets(projectId, operation.asset, (frozen) => perform(projectId, frozen), true);
}
async function serializeFile(file: File): Promise<NonNullable<RequestAsset["file"]>> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
  return { name: file.name, type: file.type, base64 };
}
function uploadFile(projectId: string, file: File, fields: Record<string, string>) {
  const principal = watchProjectPrincipal(projectId);
  return trackDraftAssetPreparation(projectId, async () => {
    principal.assertCurrent();
    const serialized = await serializeFile(file);
    principal.assertCurrent();
    return mutate(projectId, { suffix: "", method: "POST", fields, file: serialized });
  }).finally(() => principal.dispose());
}
export async function uploadAsset(
  projectId: string,
  input: {
    file: File;
    type: AssetType;
    name: string;
    ascent?: number;
    usages?: AssetUsage[];
    replace?: boolean;
  },
): Promise<Asset> {
  const result = await uploadFile(projectId, input.file, {
    type: input.type,
    name: input.name,
    ...(input.replace ? { replace: "true" } : {}),
    ...(input.usages === undefined ? {} : { usages: JSON.stringify(input.usages) }),
    ...(input.ascent === undefined ? {} : { ascent: String(input.ascent) }),
  });
  return result.asset!;
}
export async function uploadFontAsset(
  projectId: string,
  input: { name: string; file: File },
): Promise<{ asset: Asset; warnings?: string[] }> {
  const result = await uploadFile(projectId, input.file, { type: "font", name: input.name });
  return { asset: result.asset!, warnings: result.warnings };
}
/** What a copy did: the same asset was already here, or it landed under its name or a free one. */
export type AssetCopyOutcome = "reused" | "copied" | "renamed";

/** Same pixels, same type, and for a glyph the same metrics: using one or the other is the same. */
function sameAsset(a: Asset, b: Asset): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "font")
    return JSON.stringify(a.fontMeta?.glyphMap) === JSON.stringify(b.fontMeta?.glyphMap);
  if (a.contentHash !== b.contentHash) return false;
  return a.type !== "glyph" || (a.ascent === b.ascent && a.height === b.height);
}

/**
 * Copies an asset of another Project of the server into `projectId`'s draft. An
 * identical asset already there is reused; a name already taken gets `_2`, `_3`…
 * The copy is a snapshot: it keeps no link to its source.
 */
export async function copyAsset(
  projectId: string,
  source: Asset,
): Promise<{ asset: Asset; outcome: AssetCopyOutcome }> {
  if (source.projectId === projectId) return { asset: source, outcome: "reused" };
  const same = (await listAssets(projectId)).find((asset) => sameAsset(asset, source));
  if (same) return { asset: same, outcome: "reused" };
  const principal = watchProjectPrincipal(projectId);
  const result = await trackDraftAssetPreparation(projectId, async () => {
    principal.assertCurrent();
    const files = await readAssetFiles(source.projectId, source, source.draftId);
    principal.assertCurrent();
    return mutate(projectId, {
      suffix: "/copy",
      method: "POST",
      fields: {
        type: files.type,
        name: files.name,
        ...(files.descriptor === null ? {} : { descriptor: files.descriptor }),
        files: JSON.stringify(
          files.binaries.map((b) => ({ path: b.path, base64: toBase64(b.bytes) })),
        ),
      },
    });
  }).finally(() => principal.dispose());
  const asset = result.asset!;
  return { asset, outcome: asset.name === source.name ? "copied" : "renamed" };
}

export async function patchAsset(
  projectId: string,
  id: string,
  patch: { name?: string; ascent?: number; height?: number; usages?: AssetUsage[] },
): Promise<Asset> {
  return (
    await mutate(projectId, {
      suffix: `/${encodeURIComponent(id)}`,
      method: "PATCH",
      fields: Object.fromEntries(
        Object.entries(patch)
          .filter((entry) => entry[1] !== undefined)
          .map(([key, value]) => [key, key === "usages" ? JSON.stringify(value) : String(value)]),
      ),
    })
  ).asset!;
}
export async function deleteAsset(projectId: string, id: string): Promise<void> {
  await mutate(projectId, { suffix: `/${encodeURIComponent(id)}`, method: "DELETE", fields: {} });
}
export async function duplicateAsset(projectId: string, id: string): Promise<Asset> {
  return (
    await mutate(projectId, {
      suffix: `/${encodeURIComponent(id)}/duplicate`,
      method: "POST",
      fields: {},
    })
  ).asset!;
}

export interface NexoGlyph {
  id: string;
  texture: string;
  available: boolean;
}
const nexoGlyphPath = (projectId: string, id?: string) =>
  `/api/v1/user/projects/${encodeURIComponent(projectId)}/nexo-glyphs${id === undefined ? "" : `/${encodeURIComponent(id)}`}`;
export const nexoGlyphUrl = (projectId: string, id?: string) =>
  apiUrl(nexoGlyphPath(projectId, id));
export async function listNexoGlyphs(projectId: string): Promise<NexoGlyph[]> {
  try {
    return (await apiFetch<{ glyphs: NexoGlyph[] }>(nexoGlyphPath(projectId))).glyphs;
  } catch (error) {
    throw new ApiError("nexo_glyphs_unavailable", ApiError.from(error).status);
  }
}
export async function fetchNexoGlyph(projectId: string, id: string): Promise<Blob> {
  const response = await apiRequest(nexoGlyphPath(projectId, id));
  if (!response.ok) throw new ApiError(`nexo_glyph_unavailable: ${id}`, response.status);
  return response.blob();
}
