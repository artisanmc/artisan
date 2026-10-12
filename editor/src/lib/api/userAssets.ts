import type { Asset, AssetType, AssetUsage } from "@/domain/asset";
import {
  assetJsonFields,
  listLocalAssets,
  performLocalAssetMutation,
} from "@/features/assets/localAssets";
import {
  type AssetMutation,
  mutateDraftAssets,
  trackDraftAssetPreparation,
} from "@/features/project/persistedDrafts";
import { projectFetch } from "@/lib/projectFetch";
import { watchProjectPrincipal } from "@/lib/projectPrincipal";
import { SELF_HOSTED } from "@/lib/selfHosted";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { DraftApiError, type PersistedDraft } from "./projectDrafts";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const base = (projectId: string) =>
  `${API_URL}/api/v1/user/projects/${encodeURIComponent(projectId)}/assets`;
type AssetResponse = { draft: PersistedDraft; asset?: Asset; warnings?: string[] };
type RequestAsset = NonNullable<AssetMutation["asset"]>;
export async function listAssets(
  projectId: string,
  filters: { type?: AssetType; search?: string } = {},
): Promise<Asset[]> {
  const remote = useProjectDraftStore.getState().get(projectId)?.remote;
  const draftId = remote && remote.revision > 0 ? remote.id : undefined;
  // Auto-hébergé : pas de backend, l'éditeur lit l'arbre du brouillon ou du disque.
  if (SELF_HOSTED) {
    const assets = await listLocalAssets(projectId, filters, draftId);
    return assets.map((asset) => ({ ...asset, ...(draftId ? { draftId } : {}) }));
  }
  const params = new URLSearchParams(filters);
  if (draftId) params.set("draftId", draftId);
  const response = await projectFetch(projectId, `${base(projectId)}?${params}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to load assets");
  const body = (await response.json()) as { assets: Asset[] };
  return body.assets.map((asset) => ({ ...asset, ...(draftId ? { draftId } : {}) }));
}
async function perform(projectId: string, operation: AssetMutation): Promise<AssetResponse> {
  if (SELF_HOSTED) {
    const result = await performLocalAssetMutation(projectId, operation);
    return {
      ...result,
      ...(result.asset ? { asset: { ...result.asset, draftId: operation.id } } : {}),
    };
  }
  const input = operation.asset!;
  const params = new URLSearchParams({
    draftId: operation.id,
    draftRevision: String(operation.revision),
  });
  let body: BodyInit;
  const headers: Record<string, string> = { "Idempotency-Key": operation.operationId };
  if (input.file) {
    const form = new FormData();
    for (const [key, value] of Object.entries(input.fields)) form.set(key, value);
    form.set("draftSnapshot", JSON.stringify(operation.snapshot));
    form.set("draftName", operation.name);
    form.set(
      "file",
      new Blob([Uint8Array.from(atob(input.file.base64), (char) => char.charCodeAt(0))], {
        type: input.file.type,
      }),
      input.file.name,
    );
    body = form;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({
      ...assetJsonFields(input.fields),
      draftSnapshot: operation.snapshot,
      draftName: operation.name,
    });
  }
  const response = await projectFetch(projectId, `${base(projectId)}${input.suffix}?${params}`, {
    method: input.method,
    credentials: "include",
    headers,
    body,
    signal: AbortSignal.timeout(25_000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new DraftApiError(result.error ?? "asset_update_failed", response.status, result.draft);
  if (!result.draft) throw new Error("draft_acknowledgement_missing");
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
export const nexoGlyphUrl = (projectId: string, id?: string) =>
  `${API_URL}/api/v1/user/projects/${encodeURIComponent(projectId)}/nexo-glyphs${id === undefined ? "" : `/${encodeURIComponent(id)}`}`;
export async function listNexoGlyphs(projectId: string): Promise<NexoGlyph[]> {
  const response = await projectFetch(projectId, nexoGlyphUrl(projectId));
  if (!response.ok) throw new Error("nexo_glyphs_unavailable");
  return ((await response.json()) as { glyphs: NexoGlyph[] }).glyphs;
}
export async function fetchNexoGlyph(projectId: string, id: string): Promise<Blob> {
  const response = await projectFetch(projectId, nexoGlyphUrl(projectId, id));
  if (!response.ok) throw new Error(`nexo_glyph_unavailable: ${id}`);
  return response.blob();
}
