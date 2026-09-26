import { eq } from "drizzle-orm";
import { db } from "../../db";
import { projectDraftStorage } from "../../db/schema";
import type { Project } from "../projectStorage";
import { projectDiskId } from "../projectStorage";
import type { DraftStore, DraftOutcome } from "./DraftStore";
import type { ProjectStorage } from "./ProjectStorage";
import { SqlDraftStore } from "./SqlDraftStore";
import { ServerDraftStore } from "./ServerDraftStore";
import { ReceiptDraftStore } from "./ReceiptDraftStore";

class PendingDraftStore implements DraftStore {
  private async pending(): Promise<DraftOutcome> { return { kind: "result", result: { ok: false, error: "draft_migration_pending" } }; }
  list = () => this.pending();
  read = () => this.pending();
  readBlob = () => this.pending();
  create = () => this.pending();
  update = () => this.pending();
  discard = () => this.pending();
  publish = () => this.pending();
  writeBlob = () => this.pending();
}

export async function resolveDraftStore(project: Project, ownerId: string, storage: ProjectStorage): Promise<DraftStore> {
  await db.insert(projectDraftStorage).values({ projectId: project.id, state: "backend", migrationId: crypto.randomUUID(), updatedAt: new Date() }).onConflictDoNothing();
  const [gate] = await db.select().from(projectDraftStorage).where(eq(projectDraftStorage.projectId, project.id));
  if (gate?.state === "frozen" || gate?.state === "returning") return new PendingDraftStore();
  // Encore sur le disque, en attendant le rapatriement (`resumeServerDrafts`).
  if (gate?.state === "server" && project.serverKeyId) return new ReceiptDraftStore(project.id, ownerId, new ServerDraftStore(project.serverKeyId, projectDiskId(project), ownerId));
  return new SqlDraftStore(project.id, ownerId, storage);
}
