import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { projectDraftOperations, projectDrafts, projectDraftStorage } from "../../db/schema";
import { publishStoredDraft } from "../projectDrafts";
import type { ProjectStorage } from "./ProjectStorage";
import type { DraftBody, DraftOutcome, DraftResult, DraftStore, StoredDraft } from "./DraftStore";

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

/** Transitional authority only. Every operation checks the durable migration gate. */
export class LegacyDraftStore implements DraftStore {
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
  list() { return this.run("list", undefined, null, async (tx) => ({ kind: "result", result: { ok: true, drafts: (await tx.select().from(projectDrafts).where(and(this.scope(), eq(projectDrafts.status, "active"))).orderBy(desc(projectDrafts.updatedAt))).map(portableDraft) } })); }
  read(id: string) { return this.run("read", undefined, id, async (tx) => { const [row] = await tx.select().from(projectDrafts).where(this.scope(id)); return { kind: "result", result: row ? { ok: true, draft: portableDraft(row) } : { ok: false, error: "not_found" } }; }); }
  create(id: string, operationId: string, body: DraftBody) {
    return this.run("create", operationId, { id, ...body }, async (tx) => {
      if (Object.keys(body.snapshot.binaryTree ?? {}).length) return { kind: "result", result: { ok: false, error: "draft_blobs_unsupported" } };
      const now = new Date();
      const [row] = await tx.insert(projectDrafts).values({ id, projectId: this.projectId, ownerId: this.ownerId, ...body, updatedBy: this.ownerId, createdAt: now, updatedAt: now }).onConflictDoNothing().returning();
      return { kind: "result", result: row ? { ok: true, draft: portableDraft(row) } : { ok: false, error: "draft_exists" } };
    });
  }
  private mutate(action: "update" | "discard" | "publish", id: string, revision: number, operationId: string, body?: DraftBody) {
    return this.run(action, operationId, { id, revision, body }, async (tx) => {
      const [row] = await tx.select().from(projectDrafts).where(this.scope(id)).for("update");
      if (!row) return { kind: "result", result: { ok: false, error: "not_found" } };
      if (row.revision !== revision || row.status !== "active") return { kind: "result", result: { ok: false, error: "draft_conflict", draft: portableDraft(row) } };
      if (Object.keys(body?.snapshot.binaryTree ?? {}).length) return { kind: "result", result: { ok: false, error: "draft_blobs_unsupported" } };
      let wrote: number | undefined;
      if (action === "publish") {
        const outcome = await publishStoredDraft(this.storage, row.snapshot);
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
  async writeBlob(): Promise<DraftOutcome> { return { kind: "result", result: { ok: false, error: "draft_blobs_unsupported" } }; }
  async readBlob(): Promise<DraftOutcome> { return { kind: "result", result: { ok: false, error: "not_found" } }; }
}
