import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { projects, projectRenames } from "../db/schema";
import { storageDatabase, storageTransaction } from "./storage/storageTransaction";

export class ProjectRenameError extends Error {
  constructor(readonly code: string) { super(code); }
}
export const isTerminalRenameError = (error?: string) => ["destination_exists", "destination_reserved", "invalid_path", "addon_owned", "unknown_project", "operation_conflict", "project_renamed"].includes(error ?? "");
export async function findProjectRename(projectId: string, operationId: string) {
  return (await storageDatabase().select().from(projectRenames).where(and(eq(projectRenames.projectId, projectId), eq(projectRenames.id, operationId))))[0];
}
export type RenameReceipt = { operation_id: string; project_id: string; target_project_id: string };
export interface ProjectIdentityReport {
  project_roots?: { project_id: string; identity: "folder" | "addon"; module_id?: string }[];
  project_rename_results?: RenameReceipt[];
  identity_migrations?: { from: string; to: string }[];
}
export const pendingProjectRenames = (serverKeyId: string) => db.select().from(projectRenames).where(and(eq(projectRenames.serverKeyId, serverKeyId), eq(projectRenames.status, "pending")));
const renamedProjectFields = (sourceId: string, targetId: string) => ({
  externalId: targetId,
  name: sql`case when ${projects.name} = ${sourceId} then ${targetId} else ${projects.name} end`,
  updatedAt: new Date(),
});
export const projectLifecycleScope = (project: { serverKeyId: string | null; networkId: string | null; demoSessionId?:string|null }) => {
 if(project.serverKeyId)return project.serverKeyId;
 if(project.networkId)return `hosted-network:${project.networkId}`;
 if(project.demoSessionId)return `demo-session:${project.demoSessionId}`;
 throw new ProjectRenameError('invalid_location');
};

export async function beginProjectRename(projectId: string, operationId: string, targetId: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(targetId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(operationId)) throw new ProjectRenameError("invalid_input");
  const anchor = (await storageDatabase().select().from(projects).where(eq(projects.id, projectId)))[0];
  if (!anchor) throw new ProjectRenameError("not_found");
  return storageTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectLifecycleScope(anchor)}))`);
    const project = (await tx.select().from(projects).where(eq(projects.id, projectId)).for("update"))[0];
    if (!project || project.deletedAt) throw new ProjectRenameError("not_found");
    if(!project.networkId)throw new ProjectRenameError('forbidden');
    if (project.serverKeyId !== anchor.serverKeyId) throw new ProjectRenameError("operation_mismatch");
    const previous = (await tx.select().from(projectRenames).where(eq(projectRenames.id, operationId)))[0];
    if (previous) {
      if (previous.projectId !== projectId || previous.targetId !== targetId) throw new ProjectRenameError("operation_mismatch");
      return previous;
    }
    if (project.identityKind === "addon") throw new ProjectRenameError("addon_immutable");
    const scope = project.serverKeyId ? eq(projectRenames.serverKeyId, project.serverKeyId) : eq(projectRenames.hostedNetworkId, project.networkId);
    const pending = await tx.select().from(projectRenames).where(and(scope, eq(projectRenames.status, "pending")));
    if (pending.some((r) => r.projectId === projectId)) throw new ProjectRenameError("rename_in_progress");
    const occupied = await tx.select().from(projects).where(project.serverKeyId ? eq(projects.serverKeyId, project.serverKeyId) : eq(projects.networkId, project.networkId));
    if (occupied.some((p) => p.id !== projectId && (p.externalId ?? p.id).toLowerCase() === targetId.toLowerCase()) || pending.some((r) => r.targetId.toLowerCase() === targetId.toLowerCase())) throw new ProjectRenameError("destination_exists");
    const now = new Date();
    return (await tx.insert(projectRenames).values({ id: operationId, projectId, serverKeyId: project.serverKeyId, hostedNetworkId: project.serverKeyId ? null : project.networkId, sourceId: project.externalId ?? project.id, targetId, status: "pending", createdAt: now, updatedAt: now }).returning())[0]!;
  });
}

export async function completeProjectRename(serverKeyId: string, receipt: RenameReceipt) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${serverKeyId}))`);
    const operation = (await tx.select().from(projectRenames).where(eq(projectRenames.id, receipt.operation_id)).for("update"))[0];
    if (!operation || operation.serverKeyId !== serverKeyId || operation.sourceId !== receipt.project_id || operation.targetId !== receipt.target_project_id) throw new ProjectRenameError("operation_mismatch");
    if (operation.status === "complete") return operation;
    if (operation.status !== "pending") throw new ProjectRenameError("operation_mismatch");
    await tx.update(projects).set(renamedProjectFields(operation.sourceId, operation.targetId)).where(eq(projects.id, operation.projectId));
    return (await tx.update(projectRenames).set({ status: "complete", updatedAt: new Date() }).where(eq(projectRenames.id, operation.id)).returning())[0]!;
  });
}

/** Plugin identity reports are processed before any get-or-create discovery. */
export async function reconcileProjectIdentity(serverKeyId: string, report: ProjectIdentityReport) {
  for (const receipt of report.project_rename_results ?? []) {
    const known = (await db.select().from(projectRenames).where(eq(projectRenames.id, receipt.operation_id)))[0];
    // A restored plugin journal may outlive its deleted backend project.
    if (known) await completeProjectRename(serverKeyId, receipt);
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${serverKeyId}))`);
    for (const migration of report.identity_migrations ?? []) {
      if (migration.from !== "boutique_shop" || migration.to !== "boutique_addon" || !report.project_roots?.some((r) => r.project_id === migration.to && r.identity === "addon")) throw new ProjectRenameError("invalid_migration");
      const rows = await tx.select().from(projects).where(eq(projects.serverKeyId, serverKeyId));
      const source = rows.find((p) => (p.externalId ?? p.id) === migration.from);
      if (!source) continue;
      if (rows.some((p) => p.id !== source.id && (p.externalId ?? p.id).toLowerCase() === migration.to)) throw new ProjectRenameError("destination_exists");
      const pending = await tx.select().from(projectRenames).where(and(eq(projectRenames.serverKeyId, serverKeyId), eq(projectRenames.status, "pending")));
      if (pending.some((r) => r.projectId === source.id || r.targetId.toLowerCase() === migration.to)) throw new ProjectRenameError("rename_in_progress");
      await tx.update(projects).set({ externalId: migration.to, identityKind: "addon", updatedAt: new Date() }).where(eq(projects.id, source.id));
    }
    for (const root of report.project_roots ?? []) {
      if (root.identity !== "folder" && root.identity !== "addon") continue;
      const ownerModule = root.identity === "addon" && typeof root.module_id === "string" ? root.module_id : null;
      await tx.update(projects).set({ identityKind: root.identity, ownerModule }).where(and(eq(projects.serverKeyId, serverKeyId), sql`coalesce(${projects.externalId}, ${projects.id}) = ${root.project_id}`));
    }
  });
}

export async function failProjectRename(operationId: string) {
  await db.update(projectRenames).set({ status: "failed", updatedAt: new Date() }).where(and(eq(projectRenames.id, operationId), eq(projectRenames.status, "pending")));
}

export async function projectIdentityLocked(serverKeyId: string, diskId: string) {
  const operations = await pendingProjectRenames(serverKeyId);
  return operations.some((r) => r.sourceId.toLowerCase() === diskId.toLowerCase() || r.targetId.toLowerCase() === diskId.toLowerCase());
}
