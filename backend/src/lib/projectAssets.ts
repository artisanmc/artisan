import { createHash } from "node:crypto";
import type { ProjectStorage, ProjectWriteBatch } from "./storage/ProjectStorage";
import { diskAssetsFromTree, type DiskAsset } from "./diskAssets";
import { assetDiskPath, descriptorYaml, type DiskAssetDescriptor, type DiskAssetsRead } from "./assetDiskWrite";
export interface AssetWriteResult { ok: boolean; error?: string; message?: string; draft?: unknown; }
export function assetWriteError(c: any, result: AssetWriteResult) {
  const error = result.error ?? "write_error";
  return c.json({ error, ...(result.draft ? { draft: result.draft } : {}), ...(result.message ? { message: result.message } : {}) }, ["conflict", "draft_conflict", "operation_conflict", "operation_mismatch", "operation_expired"].includes(error) ? 409 : /invalid/.test(error) ? 422 : 503);
}

/** Asset parsing is shared; the bound storage owns every byte and CAS transaction. */
export class ProjectAssets {
  constructor(readonly projectId: string, readonly storage: ProjectStorage, readonly operationId: string = crypto.randomUUID(), private readonly afterWrite: () => Promise<void> = async () => {}) {}
  async read(): Promise<DiskAssetsRead> {
    const result = await this.storage.read();
    if (result.kind !== "result") return { ok: false, error: "server_offline" };
    if (!result.result.ok) return { ok: false, error: "read_error" };
    const files = result.result.files ?? [], binaries = result.result.binaries ?? [];
    return { ok: true, files, binaries, assets: diskAssetsFromTree(this.projectId, files, binaries) };
  }
  async bytes(asset: DiskAsset): Promise<Uint8Array | null> {
    const outcome = await this.storage.readBinary(asset.path);
    if (outcome.kind !== "result" || !outcome.result.ok || !outcome.result.content) return null;
    const bytes = outcome.result.content;
    if (asset.hash && createHash("sha256").update(bytes).digest("hex") !== asset.hash) return null;
    return bytes;
  }
  async commit(batch: ProjectWriteBatch): Promise<AssetWriteResult> {
    const outcome = await this.storage.write({ ...batch, operationId: this.operationId });
    if (outcome.kind !== "result") return { ok: false, error: "server_offline" };
    if (!outcome.result.ok) {
      const known = ["draft_conflict", "operation_mismatch", "operation_conflict", "operation_expired", "invalid_draft", "invalid_blob", "draft_not_active", "owner_revoked"];
      return { ok: false, error: known.includes(outcome.result.message ?? "") ? outcome.result.message : outcome.result.error ?? "write_error", ...((outcome.result as { draft?: unknown }).draft ? { draft: (outcome.result as { draft?: unknown }).draft } : {}) };
    }
    await this.afterWrite();
    return { ok: true };
  }
  writeAsset(input: { type: string; name: string; bytes: Uint8Array; descriptor: DiskAssetDescriptor; baseHash: string | null; descriptorBaseHash: string | null }, remove?: { path: string; hash: string; descriptorHash: string | null }) {
    const path = assetDiskPath(input.type, input.name);
    return this.commit({
      files: [{ path: path.replace(/\.png$/, ".yaml"), content: descriptorYaml(input.descriptor), base_hash: input.descriptorBaseHash }],
      binaries: [{ path, content: input.bytes, baseHash: input.baseHash }, ...(remove ? [{ path: remove.path, content: null, baseHash: remove.hash }] : [])],
      deletes: remove?.descriptorHash ? [{ path: remove.path.replace(/\.png$/, ".yaml"), base_hash: remove.descriptorHash }] : [],
    });
  }
  deleteAsset(input: { type: string; name: string; baseHash: string; descriptorBaseHash: string | null }) {
    const path = assetDiskPath(input.type, input.name);
    return this.commit({ files: [], binaries: [{ path, content: null, baseHash: input.baseHash }], deletes: input.descriptorBaseHash ? [{ path: path.replace(/\.png$/, ".yaml"), base_hash: input.descriptorBaseHash }] : [] });
  }
  deleteFont(input: { glyphs: Record<string, string>; descriptorPath: string; descriptorBaseHash: string | null }) {
    return this.commit({ files: [], binaries: Object.entries(input.glyphs).map(([path, baseHash]) => ({ path, content: null, baseHash })), deletes: input.descriptorBaseHash ? [{ path: input.descriptorPath, base_hash: input.descriptorBaseHash }] : [] });
  }
}
