import { rename } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { deletedDraftOwners, projectRenames, projects } from "../../db/schema";
import {
  ProjectRenameError,
  completeHostedProjectRename,
  projectLifecycleScope,
} from "../projectRename";
import { type Project, getProject } from "../projectStorage";
import { HostedProjectStorage, hostedStorageOptions } from "./HostedProjectStorage";
import { digest, logicalId, publicPath } from "./hostedFilesystem";
import { renameStoredProject } from "./projectLifecycle";
import { storageDatabase, storageTransaction } from "./storageTransaction";

export interface CreateHostedProjectInput {
  networkId: string;
  folderName: string;
  name?: string;
  minecraftVersion: string;
  ownerId: string;
  operationId: string;
  files?: Record<string, string>;
  templateId?: string;
}
/** Caller authorizes Network membership; this service owns durable identity + storage creation. */
export async function createHostedProject(input: CreateHostedProjectInput): Promise<Project> {
  if (
    !logicalId(input.folderName) ||
    !publicPath(input.folderName) ||
    !logicalId(input.operationId) ||
    !/^\d+\.\d+(?:\.\d+)?$/.test(input.minecraftVersion) ||
    !input.ownerId ||
    (input.name !== undefined && (!input.name.trim() || input.name.length > 120))
  )
    throw new ProjectRenameError("invalid_input");
  if (input.templateId && input.templateId !== "blank")
    throw new ProjectRenameError("invalid_template");
  const id = `hosted_${digest(
    JSON.stringify([input.networkId, input.ownerId, input.operationId]),
  ).slice(0, 32)}`;
  const fingerprint = digest(JSON.stringify(input));
  return storageTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hosted-maintenance'))`);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`hosted-network:${input.networkId}`}))`,
    );
    const existing = (await tx.select().from(projects).where(eq(projects.id, id)))[0];
    if (existing) {
      if (existing.hostedCreationFingerprint !== fingerprint || existing.deletedAt)
        throw new ProjectRenameError("operation_mismatch");
      return existing;
    }
    const occupied = (
      await tx
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.networkId, input.networkId),
            eq(projects.storageKind, "hosted"),
            sql`lower(${projects.externalId}) = lower(${input.folderName})`,
          ),
        )
    )[0];
    const reserved = (
      await tx
        .select()
        .from(projectRenames)
        .where(
          and(
            eq(projectRenames.hostedNetworkId, input.networkId),
            eq(projectRenames.status, "pending"),
            sql`lower(${projectRenames.targetId}) = lower(${input.folderName})`,
          ),
        )
    )[0];
    if (occupied || reserved) throw new ProjectRenameError("destination_exists");
    const now = new Date();
    const project: Project = {
      id,
      networkId: input.networkId,
      demoSessionId: null,
      serverKeyId: null,
      storageKind: "hosted",
      hostedRootId: id,
      hostedMinecraftVersion: input.minecraftVersion,
      hostedCreationFingerprint: fingerprint,
      identityKind: "folder",
      name: input.name?.trim() ?? input.folderName,
      externalId: input.folderName,
      slug: null,
      description: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const storage = await HostedProjectStorage.initialize(
      hostedStorageOptions(project, input.ownerId),
    );
    const files = input.files ?? {
      "manifest.yaml": "schema: manifest/v1\ndefault_lang: en\nlanguages: [en]\n",
    };
    const written = await storage.write({
      operationId: `create-${digest(input.operationId).slice(0, 32)}`,
      files: Object.entries(files).map(([path, content]) => ({
        path,
        content,
        base_hash: null,
      })),
    });
    if (written.kind !== "result" || !written.result.ok)
      throw new ProjectRenameError(
        written.kind === "result"
          ? (written.result.message ?? written.result.error ?? "write_error")
          : "write_error",
      );
    return (await tx.insert(projects).values(project).returning())[0]!;
  });
}
export const listHostedProjects = (networkId: string) =>
  db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.networkId, networkId),
        eq(projects.storageKind, "hosted"),
        isNull(projects.deletedAt),
      ),
    );

export async function openHostedProjectStorage(
  project: Project,
  ownerId: string,
): Promise<HostedProjectStorage> {
  const storage = await HostedProjectStorage.open({
    ...hostedStorageOptions(project, ownerId),
    rename: async (operationId, targetId) =>
      renameStoredProject(project.id, operationId, targetId, {
        canRename: project.identityKind !== "addon",
        apply: async (sourceId) => {
          const fs = storage.filesystem;
          await fs.locked(async () => {
            const current = await fs.current();
            if (current.state.deleted) throw new ProjectRenameError("not_found");
            const key = digest(`rename:${operationId}`);
            const prior = current.state.receipts[key];
            if (prior) {
              if (prior.fingerprint !== digest(JSON.stringify([sourceId, targetId])))
                throw new ProjectRenameError("operation_mismatch");
              return;
            }
            if (current.state.folderName !== sourceId)
              throw new ProjectRenameError("operation_mismatch");
            if (!publicPath(targetId)) throw new ProjectRenameError("invalid_path");
            await fs.commit(current, async (next) => {
              const staging = join(next.directory, `.rename-${crypto.randomUUID()}`);
              await rename(join(next.directory, sourceId), staging);
              await rename(staging, join(next.directory, targetId));
              next.state.folderName = targetId;
              next.state.receipts[key] = {
                fingerprint: digest(JSON.stringify([sourceId, targetId])),
                at: Date.now(),
                result: { ok: true },
              };
            });
          });
          await completeHostedProjectRename(project.id, {
            operation_id: operationId,
            project_id: sourceId,
            target_project_id: targetId,
          });
          return { ok: true };
        },
      }),
  });
  const deletedOwners = await storageDatabase()
    .select({ ownerId: deletedDraftOwners.ownerId })
    .from(deletedDraftOwners);
  if (deletedOwners.length) await storage.purgeOwners(deletedOwners.map((o) => o.ownerId));
  return storage;
}

/** SQL first revokes access; the volume retirement marker is recoverable on retry/maintenance. */
export async function deleteHostedProject(projectId: string, operationId: string): Promise<void> {
  if (!logicalId(operationId)) throw new ProjectRenameError("invalid_input");
  const project = await getProject(projectId);
  if (!project || project.storageKind !== "hosted") throw new ProjectRenameError("not_found");
  await storageTransaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${projectLifecycleScope(project)}))`,
    );
    const pending = (
      await tx
        .select()
        .from(projectRenames)
        .where(and(eq(projectRenames.projectId, projectId), eq(projectRenames.status, "pending")))
    )[0];
    if (pending) throw new ProjectRenameError("rename_in_progress");
    await tx
      .update(projects)
      .set({
        deletedAt: project.deletedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
  });
  const storage = await HostedProjectStorage.open(hostedStorageOptions(project, "lifecycle"));
  await storage.filesystem.locked(async () => {
    const current = await storage.filesystem.current();
    if (!current.state.deleted)
      await storage.filesystem.commit(current, async (next) => {
        next.state.deleted = true;
      });
  });
}
