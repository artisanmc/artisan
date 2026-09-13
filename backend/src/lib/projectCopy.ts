import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { memberships, projects, projectCopies, projectRenames, serverKeys } from "../db/schema";
import { can } from "./capabilities";
import { resolveProjectStorage } from "./storage/resolveProjectStorage";
import { storageDatabase, storageTransaction } from "./storage/storageTransaction";
import { captureProjectSnapshot, COPY_LIMITS, ProjectCopyError } from "./storage/captureProjectSnapshot";
import { digest, logicalId, publicPath } from "./storage/hostedFilesystem";
import { projectCopyTarget, requestProjectCopy, requestProjectList, getInstanceCount } from "../ws/hub";
import type { ProjectCopyMessage, ProjectCopyResultMessage } from "../protocol";
import { allocProjectSlug } from "./slugAlloc";
import { rebuildResourcePack } from "./resourcePack";
import { pushResourcePackUpdated } from "../ws/hub";
import { forgetProjectTree } from "./projectTreeReads";

type Operation = typeof projectCopies.$inferSelect;
export interface CopyTransport { target: typeof projectCopyTarget; send: typeof requestProjectCopy; list: typeof requestProjectList; connected?: (serverId: string) => boolean; afterActivate?: (projectId: string) => Promise<void> }
const defaultTransport: CopyTransport = { target: projectCopyTarget, send: requestProjectCopy, list: requestProjectList, connected: serverId => getInstanceCount(serverId) > 0, afterActivate: async projectId => {
  const project = (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
  if (!project || project.deletedAt || !project.serverKeyId) throw new Error("resource_pack_incomplete");
  forgetProjectTree(project.serverKeyId, project.externalId ?? project.id);
  const pack = await rebuildResourcePack(project.serverKeyId, { requiredProjectId: project.id });
  pushResourcePackUpdated(project.serverKeyId, pack.url, pack.hash);
} };
export interface CopyInput { operationId: string; targetServerKeyId: string; folderName: string; sourceRevision: string }
export const copyDto = (op: Operation) => ({ operationId: op.id, state: op.status, sourceRevision: op.sourceRevision, targetServerKeyId: op.serverKeyId, targetNetworkId: op.targetNetworkId, folderName: op.targetId, projectId: op.destinationProjectId, error: op.error });

async function authorize(userId: string, sourceId: string, serverKeyId?: string) {
  const database = storageDatabase();
  const source = (await database.select().from(projects).where(eq(projects.id, sourceId)))[0];
  if (!source || source.deletedAt) throw new ProjectCopyError("not_found");
  if(!source.networkId||source.demoSessionId)throw new ProjectCopyError('forbidden');
  const member = (await database.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.networkId, source.networkId))))[0];
  if (!member) throw new ProjectCopyError("forbidden");
  if (source.storageKind !== "hosted") throw new ProjectCopyError("hosted_source_required");
  if (!serverKeyId) return { source, target: null };
  const target = (await database.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId)))[0];
  if (!target) throw new ProjectCopyError("not_found");
  const targetMember = (await database.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.networkId, target.networkId))))[0];
  if (!targetMember || !can(targetMember.role, "publish_content") || !can(targetMember.role, "edit_content")) throw new ProjectCopyError("forbidden");
  return { source, target };
}

function requiredModules(files: { path: string }[]): string[] {
  const modules = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/");
    if (parts[0] === "menus" || parts[0] === "dialogs") modules.add("menus");
    if (parts[0] === "commands") modules.add("commands");
    if (parts[0] === "modules" && parts.length > 2) modules.add(parts[1]!);
  }
  return [...modules].sort();
}
function compatibility(serverKeyId: string, version: string, modules: string[], transport = defaultTransport) {
  const target = transport.target(serverKeyId);
  if (!target) return transport.connected?.(serverKeyId) ? "plugin_update_required" : "server_offline";
  if (target.minecraftVersion !== version) return "incompatible_version";
  return modules.some(id => !target.modules.includes(id)) ? "missing_module" : null;
}
export async function listCopyTargets(userId: string, sourceId: string, transport = defaultTransport) {
  const { source } = await authorize(userId, sourceId);
  const read = await (await resolveProjectStorage(userId, sourceId)).read();
  if (read.kind !== "result" || !read.result.ok || !read.result.hash || read.result.failed?.length) throw new ProjectCopyError("source_incomplete");
  const modules = requiredModules(read.result.files ?? []);
  const targets = [];
  for (const server of await db.select().from(serverKeys)) {
    try { await authorize(userId, sourceId, server.id); } catch { continue; }
    const connection = transport.target(server.id);
    if (!connection && !transport.connected?.(server.id)) continue;
    const listing = await transport.list(server.id);
    if (listing.kind !== "result" || !listing.result.ok) continue;
    const anchored = await db.select().from(projects).where(eq(projects.serverKeyId, server.id));
    const reserved = await db.select().from(projectCopies).where(and(eq(projectCopies.serverKeyId, server.id), eq(projectCopies.status, "pending")));
    const renames = await db.select().from(projectRenames).where(and(eq(projectRenames.serverKeyId, server.id), eq(projectRenames.status, "pending")));
    const used = new Set([...(listing.result.project_ids ?? []), ...anchored.map(p => p.externalId ?? p.id), ...reserved.map(p => p.targetId), ...renames.map(p => p.targetId)].map(p => p.toLowerCase()));
    const base = (source.externalId ?? "project").slice(0, 112);
    let folderName = base;
    for (let suffix = 2; used.has(folderName.toLowerCase()); suffix++) folderName = `${base}-${suffix}`;
    const reason = compatibility(server.id, source.hostedMinecraftVersion ?? "", modules, transport);
    targets.push({ serverKeyId: server.id, name: server.label ?? server.id, slug: server.slug, networkId: server.networkId, minecraftVersion: connection?.minecraftVersion ?? server.lastMcVersion, compatible: reason === null, reason, folderName });
  }
  return { targets, sourceRevision: read.result.hash };
}

export async function readCopy(userId: string, sourceId: string, operationId: string) {
  const op = (await storageDatabase().select().from(projectCopies).where(eq(projectCopies.id, operationId)))[0];
  if (!op || op.ownerId !== userId || op.sourceProjectId !== sourceId) throw new ProjectCopyError("not_found");
  await authorize(userId, sourceId, op.serverKeyId);
  return op;
}

export async function beginCopy(userId: string, sourceId: string, input: CopyInput, transport = defaultTransport) {
  if (!logicalId(input.operationId) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(input.folderName) || !publicPath(input.folderName) || !input.sourceRevision || input.sourceRevision.length > 128 || !input.targetServerKeyId) throw new ProjectCopyError("invalid_input");
  const { source, target } = await authorize(userId, sourceId, input.targetServerKeyId);
  const previous = (await db.select().from(projectCopies).where(eq(projectCopies.id, input.operationId)))[0];
  const same = (op: Operation) => op.ownerId === userId && op.sourceProjectId === sourceId && op.serverKeyId === input.targetServerKeyId && op.targetId === input.folderName && op.sourceRevision === input.sourceRevision;
  if (previous) {
    if (!same(previous)) throw new ProjectCopyError("operation_mismatch");
    return resumeCopy(userId, sourceId, input.operationId, transport);
  }
  const snapshot = await captureProjectSnapshot(await resolveProjectStorage(userId, sourceId), input.sourceRevision);
  if (!snapshot.files.some(f => f.path === "manifest.yaml")) throw new ProjectCopyError("source_incomplete");
  const modules = requiredModules(snapshot.files);
  const version = source.hostedMinecraftVersion ?? "";
  const manifest = snapshot.files.map(({ path, size, sha256 }) => ({ path, size, sha256 }));
  const fingerprint = digest(JSON.stringify({ target_id: input.folderName, minecraft_version: version, modules, files: manifest }));
  const incompatible = compatibility(input.targetServerKeyId, version, modules, transport);
  if (incompatible && incompatible !== "server_offline") throw new ProjectCopyError(incompatible);
  await storageTransaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`copy:${input.operationId}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.targetServerKeyId}))`);
    const duplicate = (await tx.select().from(projectCopies).where(eq(projectCopies.id, input.operationId)))[0];
    if (duplicate) { if (!same(duplicate)) throw new ProjectCopyError("operation_mismatch"); return; }
    await authorize(userId, sourceId, input.targetServerKeyId);
    const occupied = await tx.select().from(projects).where(and(eq(projects.serverKeyId, input.targetServerKeyId), sql`lower(coalesce(${projects.externalId}, ${projects.id})) = lower(${input.folderName})`));
    const copying = await tx.select().from(projectCopies).where(and(eq(projectCopies.serverKeyId, input.targetServerKeyId), eq(projectCopies.status, "pending"), sql`lower(${projectCopies.targetId}) = lower(${input.folderName})`));
    const renaming = await tx.select().from(projectRenames).where(and(eq(projectRenames.serverKeyId, input.targetServerKeyId), eq(projectRenames.status, "pending"), sql`lower(${projectRenames.targetId}) = lower(${input.folderName})`));
    if (occupied.length || copying.length || renaming.length) throw new ProjectCopyError("destination_exists");
    const active = await tx.select({ id: projectCopies.id }).from(projectCopies).where(and(eq(projectCopies.serverKeyId, input.targetServerKeyId), eq(projectCopies.status, "pending")));
    if (active.length >= 8) throw new ProjectCopyError("too_many_operations");
    const now = new Date();
    await tx.insert(projectCopies).values({ id: input.operationId, ownerId: userId, sourceProjectId: sourceId, sourceRevision: input.sourceRevision, serverKeyId: input.targetServerKeyId, targetId: input.folderName, targetNetworkId: target!.networkId, minecraftVersion: version, modules, fingerprint, manifest, artifact: snapshot.files, status: "pending", createdAt: now, updatedAt: now });
  });
  return resumeCopy(userId, sourceId, input.operationId, transport);
}

const terminal = new Set(["destination_exists", "destination_reserved", "invalid_path", "incompatible_version", "missing_module", "integrity_error", "operation_mismatch", "operation_conflict", "operation_expired", "too_large", "invalid_input"]);
const updateCopy = async (operationId: string, values: Partial<typeof projectCopies.$inferInsert>) => (await storageDatabase().update(projectCopies).set({ ...values, updatedAt: new Date() }).where(eq(projectCopies.id, operationId)).returning())[0]!;
async function finalizeCopy(op: Operation, receipt: ProjectCopyResultMessage) {
  const tx = storageDatabase();
  if (receipt.state !== "activated" || !receipt.ok || receipt.fingerprint !== op.fingerprint || receipt.operation_id !== op.id || receipt.target_id !== op.targetId || !receipt.file_hashes || Object.keys(receipt.file_hashes).length !== op.manifest.length || op.manifest.some(f => receipt.file_hashes![f.path] !== f.sha256)) return updateCopy(op.id, { error: "integrity_error" });
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${op.serverKeyId}))`);
  const target = (await tx.select().from(serverKeys).where(eq(serverKeys.id, op.serverKeyId)).for("update"))[0];
  if (!target || target.networkId !== op.targetNetworkId) return updateCopy(op.id, { error: "target_moved" });
  const existing = await tx.select().from(projects).where(and(eq(projects.serverKeyId, op.serverKeyId), sql`lower(coalesce(${projects.externalId}, ${projects.id})) = lower(${op.targetId})`));
  if (existing.length) return updateCopy(op.id, { error: "destination_exists" });
  const projectId = `copy_${digest(op.id).slice(0, 32)}`;
  const now = new Date();
  const slug = await allocProjectSlug(op.serverKeyId, op.targetId, tx);
  await tx.insert(projects).values({ id: projectId, networkId: op.targetNetworkId, serverKeyId: op.serverKeyId, externalId: op.targetId, slug, name: op.targetId, identityKind: "folder", storageKind: "server", createdAt: now, updatedAt: now });
  return updateCopy(op.id, { status: "completed", destinationProjectId: projectId, artifact: null, error: "resource_pack_pending" });
}
async function completeCopyRuntime(op: Operation, transport: CopyTransport) {
  if (op.status !== "completed" || op.error !== "resource_pack_pending" || !op.destinationProjectId) return op;
  try { await transport.afterActivate?.(op.destinationProjectId); return await updateCopy(op.id, { error: null }); }
  catch { return op; } // Retry from the durable flag on reconnect/status maintenance.
}
export async function resumeCopy(userId: string, sourceId: string, operationId: string, transport = defaultTransport): Promise<Operation> {
  // Serialize retries across backend processes without holding the server discovery lock over I/O.
  const operation = await storageTransaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`copy:${operationId}`}))`);
    let op = await readCopy(userId, sourceId, operationId);
    if (op.status !== "pending") return op;
    const update = async (values: Partial<typeof projectCopies.$inferInsert>) => (await tx.update(projectCopies).set({ ...values, updatedAt: new Date() }).where(eq(projectCopies.id, operationId)).returning())[0]!;
    const send = async (action: ProjectCopyMessage["action"], extra: Partial<ProjectCopyMessage> = {}) => {
      const access = await authorize(userId, sourceId, op.serverKeyId);
      if (access.target?.networkId !== op.targetNetworkId) throw new ProjectCopyError("forbidden");
      const result = await transport.send(op.serverKeyId, { ...extra, operation_id: op.id, target_id: op.targetId, fingerprint: op.fingerprint, action });
      if (result.kind !== "result") return null;
      return result.result;
    };
    const finish = (receipt: ProjectCopyResultMessage) => finalizeCopy(op, receipt);
    const failed = (result: ProjectCopyResultMessage) => update({ error: result.error ?? "copy_failed", ...(terminal.has(result.error ?? "") ? { status: "failed" as const, artifact: null } : {}) });
    let result = await send("status");
    if (!result) return update({ error: "server_offline" });
    if (!result.ok) return failed(result);
    if (result.state === "activated") return finish(result);
    if (result.state === "missing" && Date.now() - op.createdAt.getTime() >= 24 * 60 * 60 * 1000) return update({ status: "failed", error: "operation_expired", artifact: null });
    const incompatible = compatibility(op.serverKeyId, op.minecraftVersion, op.modules, transport);
    if (incompatible) return update({ error: incompatible });
    result = await send("begin", { minecraft_version: op.minecraftVersion, modules: op.modules, files: op.manifest });
    if (!result) return update({ error: "server_offline" });
    if (!result.ok) return failed(result);
    if (result.state === "activated") return finish(result);
    if (!op.artifact) throw new ProjectCopyError("artifact_missing");
    for (const file of op.artifact) {
      const bytes = Buffer.from(file.contentBase64, "base64");
      if (bytes.length !== file.size || digest(bytes) !== file.sha256) return update({ error: "integrity_error" });
      // Empty files are materialized by begin's complete manifest.
      for (let offset = 0; offset < bytes.length; offset += COPY_LIMITS.chunk) {
        result = await send("chunk", { path: file.path, offset, content_base64: bytes.subarray(offset, offset + COPY_LIMITS.chunk).toString("base64") });
        if (!result) return update({ error: "server_offline" });
        if (!result.ok) return failed(result);
      }
    }
    result = await send("commit");
    if (!result) return update({ error: "server_offline" });
    return result.ok ? finish(result) : failed(result);
  });
  return completeCopyRuntime(operation, transport);
}

/** Maintenance only asks for a receipt; revoked actors never authorize another byte or activation. */
export async function reconcileCopyReceipt(operationId: string, transport = defaultTransport) {
  const operation = await storageTransaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`copy:${operationId}`}))`);
    const op = (await tx.select().from(projectCopies).where(eq(projectCopies.id, operationId)))[0];
    if (!op || op.status !== "pending") return;
    const outcome = await transport.send(op.serverKeyId, { action: "status", operation_id: op.id, target_id: op.targetId, fingerprint: op.fingerprint });
    if (outcome.kind !== "result") return;
    const receipt = outcome.result;
    if (receipt.operation_id !== op.id || receipt.target_id !== op.targetId || receipt.fingerprint !== op.fingerprint) return;
    if (receipt.ok && receipt.state === "activated") return finalizeCopy(op, receipt);
    if (receipt.error === "operation_expired" || (receipt.ok && receipt.state === "missing" && Date.now() - op.createdAt.getTime() >= 24 * 60 * 60 * 1000)) return updateCopy(op.id, { status: "failed", error: "operation_expired", artifact: null });
  });
  return operation ? completeCopyRuntime(operation, transport) : undefined;
}
export async function resumeServerCopies(serverKeyId: string) {
  const pending = await db.select().from(projectCopies).where(and(eq(projectCopies.serverKeyId, serverKeyId), sql`(${projectCopies.status} = 'pending' OR (${projectCopies.status} = 'completed' AND ${projectCopies.error} = 'resource_pack_pending'))`));
  for (const op of pending) {
    if (op.status === "completed") { await completeCopyRuntime(op, defaultTransport); continue; }
    try { await resumeCopy(op.ownerId, op.sourceProjectId, op.id); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && ["forbidden", "not_found", "hosted_source_required"].includes(String(error.code))) await reconcileCopyReceipt(op.id);
      else console.error("[copies] operation pending", op.id, error);
    }
  }
}
