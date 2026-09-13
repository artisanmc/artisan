import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db";
import { deletedDraftOwners, projectDrafts, projectDraftStorage, projectDraftOperations, projectRenames, projects } from "../db/schema";
import { expireDraftReceipts } from "./storage/ReceiptDraftStore";
import { requestProjectDraft, supportsProjectDrafts } from "../ws/hub";
import { projectDiskId, type Project } from "./projectStorage";
import { lockDraftProject, portableDraft } from "./storage/LegacyDraftStore";
import type { DraftTransport } from "./storage/ServerDraftStore";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function migrateProjectDrafts(project: Project, transport: DraftTransport = requestProjectDraft) {
  if (!project.serverKeyId) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${project.serverKeyId}))`);
    await lockDraftProject(tx, project.id);
    await tx.insert(projectDraftStorage).values({ projectId: project.id, migrationId: crypto.randomUUID(), state: "frozen", updatedAt: new Date() }).onConflictDoNothing();
    await tx.update(projectDraftStorage).set({ state: "frozen", updatedAt: new Date() }).where(and(eq(projectDraftStorage.projectId, project.id), eq(projectDraftStorage.state, "backend")));
  });
  // Freeze commits before transport starts; a failed copy stays explicitly frozen.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${project.serverKeyId}))`);
    await lockDraftProject(tx, project.id);
    const [gate] = await tx.select().from(projectDraftStorage).where(eq(projectDraftStorage.projectId, project.id));
    if (!gate || gate.state === "server") return;
    const [current] = await tx.select().from(projects).where(eq(projects.id, project.id));
    if (!current || current.deletedAt || projectDiskId(current) !== projectDiskId(project)) return;
    if ((await tx.select().from(projectRenames).where(and(eq(projectRenames.projectId, project.id), eq(projectRenames.status, "pending")))).length) return;
    const rows = await tx.select().from(projectDrafts).where(eq(projectDrafts.projectId, project.id));
    const expected = rows.map(portableDraft);
    for (const draft of expected) {
      const imported = await transport(project.serverKeyId!, { project_id: projectDiskId(project), owner_id: draft.ownerId, action: "import", draft_id: draft.id, operation_id: `${gate.migrationId}:${draft.id}`, draft });
      if (imported.kind !== "result" || !imported.result.ok) return;
    }
    const readback = await transport(project.serverKeyId!, { project_id: projectDiskId(project), owner_id: "", action: "list_all" });
    if (readback.kind !== "result" || !readback.result.ok || !Array.isArray(readback.result.drafts)) return;
    for (const draft of expected) {
      if (!readback.result.drafts.some((actual) => actual.id === draft.id && canonical(actual) === canonical(draft))) return;
      for (const ref of [...Object.values(draft.snapshot.binaryBaseline ?? {}), ...Object.values(draft.snapshot.binaryTree ?? {})]) {
        const blob = await transport(project.serverKeyId!, { project_id: projectDiskId(project), owner_id: draft.ownerId, action: "read_blob", draft_id: draft.id, hash: ref.hash });
        if (blob.kind !== "result" || !blob.result.ok || typeof blob.result.content_base64 !== "string") return;
        const bytes = Buffer.from(blob.result.content_base64, "base64");
        if (bytes.length !== ref.size || createHash("sha256").update(bytes).digest("hex") !== ref.hash) return;
      }
    }
    await tx.update(projectDraftStorage).set({ state: "server", updatedAt: new Date() }).where(eq(projectDraftStorage.projectId, project.id));
    await tx.update(projectDraftOperations).set({ expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }).where(eq(projectDraftOperations.projectId, project.id));
    await tx.delete(projectDrafts).where(eq(projectDrafts.projectId, project.id));
  });
}

/** Tombstones survive owner/network deletion and apply again to manually copied roots. */
const running = new Map<string, Promise<void>>();
export function resumeServerDrafts(serverKeyId: string): Promise<void> {
  const current = running.get(serverKeyId);
  if (current) return current;
  const task = migrateServer(serverKeyId).finally(() => running.delete(serverKeyId));
  running.set(serverKeyId, task);
  return task;
}
async function migrateServer(serverKeyId: string) {
  await expireDraftReceipts();
  if (!supportsProjectDrafts(serverKeyId)) return;
  const roots = await db.select().from(projects).where(and(eq(projects.serverKeyId, serverKeyId), isNull(projects.deletedAt)));
  const revoked = await db.select().from(deletedDraftOwners);
  for (const project of roots) {
    let purged = true;
    for (const owner of revoked) {
      const purge = await requestProjectDraft(serverKeyId, { project_id: projectDiskId(project), owner_id: owner.ownerId, action: "purge_owner", operation_id: `purge:${owner.ownerId}` });
      if (purge.kind !== "result" || !purge.result.ok) { purged = false; break; }
    }
    if (purged) {
      try { await migrateProjectDrafts(project); }
      catch (error) { console.error(`[drafts] migration pending for ${project.id}`, error); }
    }
  }
}
