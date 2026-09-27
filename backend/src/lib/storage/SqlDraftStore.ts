import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import { projectDraftBlobs, projectDraftOperations, projectDrafts, projectDraftStorage } from "../../db/schema";
import { applyRenames, planWrite } from "../../../../editor/src/features/project/diskSave";
import { rebaseDraft } from "../draftRebase";
import type { BinaryWrite, ProjectStorage } from "./ProjectStorage";
import type { DraftBody, DraftOutcome, DraftResult, DraftSnapshot, DraftStore, StoredDraft } from "./DraftStore";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const MAX_BLOB = 20 * 1024 * 1024;

export function portableDraft(row: typeof projectDrafts.$inferSelect): StoredDraft {
  const { projectId: _project, createdAt, updatedAt, ...draft } = row;
  return { ...draft, schema: "artisan-draft/v1", createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}
export function draftOperationFingerprint(action: string, input: unknown) {
  return createHash("sha256").update(JSON.stringify([action, input])).digest("hex");
}
export async function lockDraftProject(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], projectId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'draft:' + projectId}))`);
}

/**
 * Brouillons des projets serveur, autorité backend (ADR
 * `snapshot-mirror-and-backend-history`, décision 4). Chaque opération vérifie
 * le verrou de migration ; les images modifiées vivent dans `project_draft_blobs`.
 */
export class SqlDraftStore implements DraftStore {
  constructor(private readonly projectId: string, private readonly ownerId: string, private readonly storage: ProjectStorage) {}
  private scope(id?: string) {
    return and(eq(projectDrafts.projectId, this.projectId), eq(projectDrafts.ownerId, this.ownerId), id === undefined ? undefined : eq(projectDrafts.id, id));
  }
  private async run(action: string, operationId: string | undefined, input: unknown, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<DraftOutcome>): Promise<DraftOutcome> {
    return db.transaction(async (tx) => {
      await lockDraftProject(tx, this.projectId);
      const [gate] = await tx.select().from(projectDraftStorage).where(eq(projectDraftStorage.projectId, this.projectId));
      if (gate && gate.state !== "backend") return { kind: "result", result: { ok: false, error: "draft_migration_pending" } };
      const fingerprint = draftOperationFingerprint(action, input);
      if (operationId) {
        const [previous] = await tx.select().from(projectDraftOperations).where(and(eq(projectDraftOperations.projectId, this.projectId), eq(projectDraftOperations.ownerId, this.ownerId), eq(projectDraftOperations.operationId, operationId)));
        if (previous) return { kind: "result", result: previous.fingerprint === fingerprint ? previous.result : { ok: false, error: "operation_mismatch" } };
      }
      const result = await fn(tx);
      if (operationId && result.kind === "result") await tx.insert(projectDraftOperations).values({ projectId: this.projectId, ownerId: this.ownerId, operationId, fingerprint, result: result.result });
      return result;
    });
  }
  list() {
    return this.run("list", undefined, null, async (tx) => {
      const rows = await tx.select().from(projectDrafts).where(and(this.scope(), eq(projectDrafts.status, "active"))).orderBy(desc(projectDrafts.updatedAt));
      const current = rows.length ? await this.current() : null;
      return { kind: "result", result: { ok: true, drafts: rows.map((row) => rebased(portableDraft(row), current).draft) } };
    });
  }
  read(id: string) {
    return this.run("read", undefined, id, async (tx) => {
      const [row] = await tx.select().from(projectDrafts).where(this.scope(id));
      if (!row) return { kind: "result", result: { ok: false, error: "not_found" } };
      const draft = portableDraft(row);
      const current = draft.status === "active" ? await this.current() : null;
      return { kind: "result", result: { ok: true, ...rebased(draft, current) } };
    });
  }
  /** Le Snapshot courant, pour rebaser à l'ouverture ; `null` si le serveur ne répond pas. */
  private async current() {
    const outcome = await this.storage.read();
    if (outcome.kind !== "result" || !outcome.result.ok || !outcome.result.files) return null;
    return {
      files: Object.fromEntries(outcome.result.files.map((f) => [f.path, f.content])),
      binaries: Object.fromEntries((outcome.result.binaries ?? []).map((b) => [b.path, { hash: b.hash, size: b.size }])),
    };
  }
  /** Chaque image modifiée doit avoir ses octets : dans ce brouillon, ou dans un autre du même auteur. */
  private async ensureBlobs(tx: Tx, id: string, snapshot: DraftSnapshot): Promise<string | undefined> {
    const needed = changedBinaries(snapshot).flatMap(({ meta }) => (meta ? [meta] : []));
    if (!needed.length) return undefined;
    const hashes = [...new Set(needed.map((m) => m.hash))];
    const own = await tx.select({ hash: projectDraftBlobs.hash }).from(projectDraftBlobs).where(and(eq(projectDraftBlobs.draftId, id), inArray(projectDraftBlobs.hash, hashes)));
    const have = new Set(own.map((b) => b.hash));
    for (const meta of needed) {
      if (have.has(meta.hash)) continue;
      const [source] = await tx.select({ content: projectDraftBlobs.content }).from(projectDraftBlobs)
        .innerJoin(projectDrafts, eq(projectDrafts.id, projectDraftBlobs.draftId))
        .where(and(eq(projectDraftBlobs.hash, meta.hash), eq(projectDrafts.projectId, this.projectId), eq(projectDrafts.ownerId, this.ownerId), ne(projectDrafts.id, id)));
      if (!source || source.content.length !== meta.size || sha256(source.content) !== meta.hash) return "missing_blob";
      await tx.insert(projectDraftBlobs).values({ draftId: id, hash: meta.hash, content: source.content }).onConflictDoNothing();
      have.add(meta.hash);
    }
    return undefined;
  }
  create(id: string, operationId: string, body: DraftBody) {
    return this.run("create", operationId, { id, ...body }, async (tx) => {
      const now = new Date();
      const [row] = await tx.insert(projectDrafts).values({ id, projectId: this.projectId, ownerId: this.ownerId, ...body, updatedBy: this.ownerId, createdAt: now, updatedAt: now }).onConflictDoNothing().returning();
      if (!row) return { kind: "result", result: { ok: false, error: "draft_exists" } };
      const missing = await this.ensureBlobs(tx, id, body.snapshot);
      if (missing) {
        await tx.delete(projectDrafts).where(this.scope(id));
        return { kind: "result", result: { ok: false, error: missing } };
      }
      return { kind: "result", result: { ok: true, draft: portableDraft(row) } };
    });
  }
  private mutate(action: "update" | "discard" | "publish", id: string, revision: number, operationId: string, body?: DraftBody) {
    return this.run(action, operationId, { id, revision, body }, async (tx) => {
      const [row] = await tx.select().from(projectDrafts).where(this.scope(id)).for("update");
      if (!row) return { kind: "result", result: { ok: false, error: "not_found" } };
      if (row.revision !== revision || row.status !== "active") return { kind: "result", result: { ok: false, error: "draft_conflict", draft: portableDraft(row) } };
      if (body) {
        const missing = await this.ensureBlobs(tx, id, body.snapshot);
        if (missing) return { kind: "result", result: { ok: false, error: missing } };
      }
      let wrote: number | undefined;
      if (action === "publish") {
        const outcome = await this.publishSnapshot(tx, id, row.snapshot, operationId);
        if (outcome.kind !== "result") return outcome;
        if (!outcome.result.ok) return { kind: "result", result: outcome.result as DraftResult };
        wrote = outcome.wrote;
      }
      const [updated] = await tx.update(projectDrafts).set({ ...body, status: action === "publish" ? "published" : action === "discard" ? "discarded" : "active", revision: revision + 1, updatedBy: this.ownerId, updatedAt: new Date() }).where(this.scope(id)).returning();
      return { kind: "result", result: { ok: true, draft: portableDraft(updated!), ...(wrote === undefined ? {} : { wrote }) } };
    });
  }
  update(id: string, revision: number, operationId: string, body: DraftBody) { return this.mutate("update", id, revision, operationId, body); }
  discard(id: string, revision: number, operationId: string) { return this.mutate("discard", id, revision, operationId); }
  publish(id: string, revision: number, operationId: string) { return this.mutate("publish", id, revision, operationId); }
  writeBlob(id: string, revision: number, operationId: string, hash: string, contentBase64: string) {
    return this.run("write_blob", operationId, { id, revision, hash, contentBase64 }, async (tx) => {
      const [row] = await tx.select().from(projectDrafts).where(this.scope(id));
      if (!row) return { kind: "result", result: { ok: false, error: "not_found" } };
      if (row.revision !== revision || row.status !== "active") return { kind: "result", result: { ok: false, error: "draft_conflict", draft: portableDraft(row) } };
      const bytes = new Uint8Array(Buffer.from(contentBase64, "base64"));
      if (!/^[a-f0-9]{64}$/.test(hash) || bytes.length > MAX_BLOB || sha256(bytes) !== hash) return { kind: "result", result: { ok: false, error: "invalid_blob" } };
      await tx.insert(projectDraftBlobs).values({ draftId: id, hash, content: bytes }).onConflictDoNothing();
      return { kind: "result", result: { ok: true, draft: portableDraft(row) } };
    });
  }
  readBlob(id: string, hash: string) {
    return this.run("read_blob", undefined, { id, hash }, async (tx) => {
      const [blob] = await tx.select({ content: projectDraftBlobs.content }).from(projectDraftBlobs)
        .innerJoin(projectDrafts, eq(projectDrafts.id, projectDraftBlobs.draftId))
        .where(and(this.scope(id), eq(projectDraftBlobs.hash, hash)));
      return { kind: "result", result: blob ? { ok: true, content_base64: Buffer.from(blob.content).toString("base64") } : { ok: false, error: "not_found" } };
    });
  }
  /** Texte, images, suppressions et renommages en un seul `project_write`, en compare-and-swap. */
  private async publishSnapshot(tx: Tx, id: string, snapshot: DraftSnapshot, operationId: string) {
    const plan = await applyRenames(await planWrite(snapshot.baseline, snapshot.tree), snapshot.renames ?? [], snapshot.baseline);
    const binaries: BinaryWrite[] = [];
    for (const { path, meta, baseHash } of changedBinaries(snapshot)) {
      let content: Uint8Array | null = null;
      if (meta) {
        const [blob] = await tx.select({ content: projectDraftBlobs.content }).from(projectDraftBlobs).where(and(eq(projectDraftBlobs.draftId, id), eq(projectDraftBlobs.hash, meta.hash)));
        if (!blob || blob.content.length !== meta.size || sha256(blob.content) !== meta.hash) return { kind: "result" as const, result: { ok: false, error: "missing_blob" }, wrote: 0 };
        content = blob.content;
      }
      binaries.push({ path, content, baseHash });
    }
    const count = plan.files.length + plan.deletes.length + plan.renames.length + binaries.length;
    if (!count) return { kind: "result" as const, result: { ok: true }, wrote: 0 };
    // Base vide = rien de publié : la première publication crée le dossier.
    const create = Object.keys(snapshot.baseline).length === 0 && Object.keys(snapshot.binaryBaseline ?? {}).length === 0;
    const result = await this.storage.write({ ...plan, ...(binaries.length ? { binaries } : {}), operationId, create });
    return { ...result, wrote: count };
  }
}

/** Images dont la version du brouillon diffère de la base publiée (`meta` absent = supprimée). */
function changedBinaries(snapshot: DraftSnapshot) {
  const base = snapshot.binaryBaseline ?? {};
  const tree = snapshot.binaryTree ?? base;
  const changed: { path: string; meta: { hash: string; size: number } | null; baseHash: string | null }[] = [];
  for (const path of new Set([...Object.keys(base), ...Object.keys(tree)])) {
    if (base[path]?.hash === tree[path]?.hash) continue;
    changed.push({ path, meta: tree[path] ?? null, baseHash: base[path]?.hash ?? null });
  }
  return changed;
}

/** Le brouillon rebasé sur le Snapshot ; ses conflits voyagent avec lui, pour l'éditeur. */
function rebased(draft: StoredDraft, current: { files: Record<string, string>; binaries: Record<string, { hash: string; size: number }> } | null): { draft: StoredDraft } {
  if (!current || draft.status !== "active") return { draft };
  const { snapshot, conflicts } = rebaseDraft(draft.snapshot, current);
  return { draft: { ...draft, snapshot, ...(conflicts.length ? { conflicts } : {}) } };
}
