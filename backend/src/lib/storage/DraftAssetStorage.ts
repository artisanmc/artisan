import { createHash } from "node:crypto";
import type { ProjectStorage, ProjectWriteBatch } from "./ProjectStorage";
import type { DraftSnapshot, StoredDraft } from "./DraftStore";
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
/** Private assets reuse shared handlers; only an explicit draft publish changes public files. */
export class DraftAssetStorage implements ProjectStorage {
  readonly drafts;
  readonly capabilities;
  updatedDraft?: StoredDraft;
  constructor(private readonly published: ProjectStorage, private readonly draft: StoredDraft, private readonly snapshot: DraftSnapshot = draft.snapshot, private readonly revision = draft.revision, private readonly name = draft.name) { this.drafts = published.drafts; this.capabilities = published.capabilities; }
  async read() { return { kind: "result" as const, result: { ok: true, files: Object.entries(this.snapshot.tree).map(([path, content]) => ({ path, content })), binaries: Object.entries(this.snapshot.binaryTree ?? {}).map(([path, meta]) => ({ path, ...meta })), failed: [] } }; }
  async readBinary(path: string) {
    const meta = this.snapshot.binaryTree?.[path];
    if (!meta) return { kind: "result" as const, result: { ok: false, error: "invalid_path" as const } };
    let original: Awaited<ReturnType<ProjectStorage["readBinary"]>> | undefined;
    if (this.snapshot.binaryBaseline?.[path]?.hash === meta.hash && this.published.readAssetBinary) {
      original = await this.published.readAssetBinary(path, meta.hash);
      if (original.kind === "result" && original.result.ok && original.result.content && hash(original.result.content) === meta.hash) return original;
    }
    const own = await this.drafts.readBlob(this.draft.id, meta.hash);
    if (own.kind !== "result") return own;
    if (own.result.ok && own.result.content_base64 !== undefined) return { kind: "result" as const, result: { ok: true, content: new Uint8Array(Buffer.from(own.result.content_base64, "base64")), hash: meta.hash } };
    original ??= await (this.published.readAssetBinary?.(path, meta.hash) ?? this.published.readBinary(path));
    if (original.kind !== "result") return original;
    if (!original.result.ok) return original;
    if (!original.result.content || hash(original.result.content) !== meta.hash) return { kind: "result" as const, result: { ok: false, error: "read_error" as const } };
    return original;
  }
  async write(batch: ProjectWriteBatch) {
    if (batch.renames?.length) return { kind: "result" as const, result: { ok: false, error: "invalid_path" as const, message: "asset_renames_require_mixed_batch" } };
    if (!batch.operationId) return { kind: "result" as const, result: { ok: false, error: "write_error" as const, message: "operation_id_required" } };
    const next = structuredClone(this.snapshot); next.binaryTree ??= {};
    const conflicts: { path: string; disk: string | null }[] = [];
    for (const f of [...batch.files, ...(batch.deletes ?? [])]) { const current = next.tree[f.path]; if ((current === undefined ? null : hash(current)) !== f.base_hash) conflicts.push({ path: f.path, disk: current ?? null }); }
    for (const b of batch.binaries ?? []) if ((next.binaryTree[b.path]?.hash ?? null) !== b.baseHash) conflicts.push({ path: b.path, disk: null });
    if (conflicts.length) return { kind: "result" as const, result: { ok: false, error: "conflict" as const, conflicts } };
    for (const f of batch.files) next.tree[f.path] = f.content;
    for (const d of batch.deletes ?? []) delete next.tree[d.path];
    for (const b of batch.binaries ?? []) {
      if (b.content === null) { delete next.binaryTree[b.path]; continue; }
      const digest = hash(b.content);
      const blob = await this.drafts.writeBlob(this.draft.id, this.revision, hash(`${batch.operationId}:${digest}`), digest, Buffer.from(b.content).toString("base64"));
      if (blob.kind !== "result") return blob;
      if (!blob.result.ok) { this.updatedDraft = blob.result.draft; return { kind: "result" as const, result: { ok: false, error: "write_error" as const, message: blob.result.error, draft: blob.result.draft } }; }
      next.binaryTree[b.path] = { hash: digest, size: b.content.length };
    }
    const saved = await this.drafts.update(this.draft.id, this.revision, batch.operationId, { name: this.name, snapshot: next });
    if (saved.kind !== "result") return saved;
    this.updatedDraft = saved.result.draft;
    return { kind: "result" as const, result: { ok: saved.result.ok, ...(saved.result.ok ? {} : { error: "write_error" as const, message: saved.result.error, draft: saved.result.draft }) } };
  }
  async writeBinaries(_files: import("./ProjectStorage").BinaryWrite[]) { return { kind: "result" as const, result: { ok: false, error: "write_error" as const, message: "atomic_batch_required" } }; }
  history(path: string) { return this.published.history(path); }
  async rename(operationId: string) { return { ok: false as const, operationId, error: "draft_operation_unsupported" }; }
}
