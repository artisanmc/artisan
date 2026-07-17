import { and, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import { db } from "../db/index";
import { ensureAssets, assetsDone } from "../lib/mcAssets";
import { networks, projectBranches, projectCommits, projects, serverKeyHelloes, serverKeys, serverModules, serverDataSources } from "../db/schema";
import { createProject, getProject, upsertProjectContent } from "../lib/projectStorage";
import { importProjectFromFiles, isEmptyStub } from "../lib/projectImport";
import { getBranch, advanceBranchHead } from "../lib/branchStorage";
import { createCommit } from "../lib/commitStorage";
import { computeAllPacksHash } from "../lib/hashUtils";
import { customItemsCacheDir, readCustomItemsHash, processBundle } from "../lib/customItems";
import { currentPackInfo } from "../lib/resourcePack";
import type {
  BundleAvailableMessage,
  CustomItemsBundleMessage,
  CustomItemsChangedMessage,
  CustomItemsRequestMessage,
  DataSourceFetchMessage,
  DataSourceFetchResultMessage,
  EditorDraftUpdateMessage,
  HelloAckMessage,
  HelloMessage,
  ModulesChangedMessage,
  ReportedDataSource,
  ResourcePackUpdatedMessage,
} from "../protocol";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";
// BUNDLE_BASE_URL is the URL the *plugin* uses to download bundles.
// In Docker, this should be the internal service URL (e.g. http://backend:3001)
// while API_BASE_URL remains the browser-accessible URL.
const BUNDLE_BASE_URL = process.env.BUNDLE_BASE_URL ?? API_BASE_URL;
const EDITOR_URL = process.env.EDITOR_URL ?? "http://localhost:5173";

// Per-connection send functions (all connections, authenticated or not)
export const connSenders = new Map<string, (msg: string) => void>();
// Authenticated sessions: sessionId → serverId
const activeSessions = new Map<string, string>();
// Editor WS connections: sessionId → sendFn
export const editorSenders = new Map<string, (msg: string) => void>();
// sessionId → Set<serverKeyId> (for grouping editors by server). Session-token
// conns carry a singleton set; ticket-auth (user-mode) conns carry the full
// set of serverKeyIds across all the user's networks.
export const editorTokenToServers = new Map<string, Set<string>>();
// connId → serverKeyId (set after successful hello)
export const connToServerId = new Map<string, string>();
// serverKeyId → minecraft version (set on hello, used by /api/items)
const serverIdToMcVersion = new Map<string, string>();

export function registerConn(connId: string, send: (msg: string) => void): void {
  connSenders.set(connId, send);
}

export function cleanupConn(connId: string): void {
  connSenders.delete(connId);
  connToServerId.delete(connId);
}

/**
 * Number of plugin instances currently authenticated against this server_key.
 * A single server_key can be claimed by N physical Minecraft servers (on-demand
 * scaling, blue/green deploys, …) so this is the right cardinality to surface
 * in the editor's bindings panel.
 */
export function getInstanceCount(serverKeyId: string): number {
  let n = 0;
  for (const id of connToServerId.values()) if (id === serverKeyId) n++;
  return n;
}

// ── data source preview: correlated request/response over the plugin WS ─────
export const DATA_SOURCE_FETCH_TIMEOUT_MS = 5_000;

export type DataSourceFetchOutcome =
  | { kind: "result"; result: DataSourceFetchResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

const pendingFetches = new Map<string, (outcome: DataSourceFetchOutcome) => void>();

/**
 * Ask the live plugin bound to `serverKeyId` to fetch + shape a data source.
 * Resolves `offline` when no plugin conn is bound, `timeout` after `timeoutMs`
 * (default 5 s — also covers old plugins that ignore the message, forward-compat).
 * Multi-instance keys: the first live connection is used (preview data, not state).
 */
export function requestDataSourceFetch(
  serverKeyId: string,
  req: {
    ref: string;
    params?: Record<string, unknown>;
    filter?: Record<string, string>;
    sort?: { by: string; direction?: "asc" | "desc" } | null;
    limit?: number | null;
    args?: Record<string, string>;
  },
  timeoutMs: number = DATA_SOURCE_FETCH_TIMEOUT_MS,
): Promise<DataSourceFetchOutcome> {
  let send: ((msg: string) => void) | undefined;
  for (const [cId, sId] of connToServerId) {
    if (sId === serverKeyId) { send = connSenders.get(cId); if (send) break; }
  }
  if (!send) return Promise.resolve({ kind: "offline" });

  const requestId = crypto.randomUUID();
  const msg: DataSourceFetchMessage = {
    type: "data_source_fetch",
    request_id: requestId,
    ref: req.ref,
    params: req.params ?? {},
    filter: req.filter ?? {},
    sort: req.sort ?? null,
    limit: req.limit ?? null,
    args: req.args ?? {},
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingFetches.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingFetches.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingFetches.delete(requestId);
      resolve(outcome);
    });
    send(JSON.stringify(msg));
  });
}

/**
 * Drop authentication for every live plugin connection bound to this server_key,
 * and clear any active editor sessions tied to it. The underlying WS sockets
 * remain open until the next ping timeout, but their messages will no longer
 * resolve to this server_key — so a rotated/revoked key can't keep pushing
 * `custom_items_bundle`, `local_push`, etc.
 */
export function disconnectServerKey(serverKeyId: string): number {
  let n = 0;
  for (const [connId, sId] of connToServerId) {
    if (sId === serverKeyId) {
      connToServerId.delete(connId);
      n++;
    }
  }
  for (const [sid, sId] of activeSessions) {
    if (sId === serverKeyId) activeSessions.delete(sid);
  }
  return n;
}

export function cleanupSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

export function registerEditorConn(
  sessionId: string,
  serverKeyIds: string | Set<string>,
  send: (msg: string) => void,
): void {
  editorSenders.set(sessionId, send);
  editorTokenToServers.set(sessionId, typeof serverKeyIds === "string" ? new Set([serverKeyIds]) : serverKeyIds);
}

export function cleanupEditorConn(sessionId: string): void {
  editorSenders.delete(sessionId);
  editorTokenToServers.delete(sessionId);
}

async function validateServerKey(rawKey: string): Promise<{ id: string; allowedIps: string[] | null } | null> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  if (rows.length === 0) return null;
  return { id: rows[0].id, allowedIps: rows[0].allowedIps ?? null };
}

/**
 * Replace the active module set for a server_key with the set reported at
 * `hello` (`installed_modules`). Upsert each reported module, then prune the
 * ones no longer reported. Presence only — never touches authored content.
 * Exported for direct testing; called fire-and-forget from the hello handler.
 */
export async function persistServerModules(
  serverKeyId: string,
  installed: { id: string; version: string }[],
): Promise<void> {
  const now = new Date();
  for (const m of installed) {
    await db
      .insert(serverModules)
      .values({ serverKeyId, moduleId: m.id, version: m.version ?? null, lastSeen: now })
      .onConflictDoUpdate({
        target: [serverModules.serverKeyId, serverModules.moduleId],
        set: { version: m.version ?? null, lastSeen: now },
      });
  }
  const keepIds = installed.map((m) => m.id);
  await db
    .delete(serverModules)
    .where(
      keepIds.length > 0
        ? and(eq(serverModules.serverKeyId, serverKeyId), notInArray(serverModules.moduleId, keepIds))
        : eq(serverModules.serverKeyId, serverKeyId),
    );
}

/**
 * Same semantics as persistServerModules, for reported data sources.
 * Exported for direct testing; called fire-and-forget from the hello and
 * modules_changed handlers.
 */
export async function persistServerDataSources(
  serverKeyId: string,
  reported: ReportedDataSource[],
): Promise<void> {
  const now = new Date();
  for (const ds of reported) {
    const schemaJson = ds.schema && ds.schema.length > 0 ? JSON.stringify(ds.schema) : null;
    const stability = ds.stability ?? null;
    const keyField = ds.key_field ?? null;
    await db
      .insert(serverDataSources)
      .values({
        serverKeyId, ref: ds.ref, schemaHint: ds.schema_hint ?? null,
        moduleId: ds.module_id ?? null, schemaJson, stability, keyField, reportedAt: now,
      })
      .onConflictDoUpdate({
        target: [serverDataSources.serverKeyId, serverDataSources.ref],
        set: { schemaHint: ds.schema_hint ?? null, moduleId: ds.module_id ?? null, schemaJson, stability, keyField, reportedAt: now },
      });
  }
  const keepRefs = reported.map((d) => d.ref);
  await db
    .delete(serverDataSources)
    .where(
      keepRefs.length > 0
        ? and(eq(serverDataSources.serverKeyId, serverKeyId), notInArray(serverDataSources.ref, keepRefs))
        : eq(serverDataSources.serverKeyId, serverKeyId),
    );
}

async function handleCustomItemsHash(serverKeyId: string, incomingHash: string | undefined): Promise<void> {
  if (!incomingHash) return;
  const cacheDir = customItemsCacheDir(serverKeyId);
  const cachedHash = await readCustomItemsHash(cacheDir);
  if (incomingHash === cachedHash) return;
  const request = JSON.stringify({ type: "custom_items_request" } satisfies CustomItemsRequestMessage);
  for (const [cId, sId] of connToServerId) {
    if (sId !== serverKeyId) continue;
    connSenders.get(cId)?.(request);
  }
}

export async function handlePluginMessage(
  connId: string,
  raw: string,
  sourceIp: string = "unknown",
): Promise<{ reply: string | null; sessionId?: string; push?: string[] }> {
  let msg: { type: string };
  try { msg = JSON.parse(raw); } catch { return { reply: null }; }

  // ── authenticated hello ──────────────────────────────────────────────────
  if (msg.type === "hello") {
    if (typeof (msg as Record<string, unknown>).server_key !== "string") return { reply: null };
    const hello = msg as HelloMessage;
    const validated = await validateServerKey(hello.server_key);
    if (!validated) return { reply: null };
    const keyId = validated.id;

    // IP allowlist gate. Empty/null list = no restriction (default).
    if (validated.allowedIps && validated.allowedIps.length > 0 && !validated.allowedIps.includes(sourceIp)) {
      db.insert(serverKeyHelloes).values({
        id: crypto.randomUUID(),
        serverKeyId: keyId,
        ip: sourceIp,
        mcVersion: hello.minecraft_version,
        helloAt: new Date(),
        rejectedReason: "ip_not_allowed",
      }).catch(() => {});
      return { reply: null };
    }

    const sessionId = crypto.randomUUID();
    activeSessions.set(sessionId, keyId);
    connToServerId.set(connId, keyId);
    serverIdToMcVersion.set(keyId, hello.minecraft_version);
    db.update(serverKeys).set({ lastMcVersion: hello.minecraft_version }).where(eq(serverKeys.id, keyId)).catch(() => {});
    db.insert(serverKeyHelloes).values({
      id: crypto.randomUUID(),
      serverKeyId: keyId,
      ip: sourceIp,
      mcVersion: hello.minecraft_version,
      helloAt: new Date(),
    }).catch(() => {});
    persistServerModules(keyId, hello.installed_modules ?? []).catch(() => {});
    persistServerDataSources(keyId, hello.data_sources ?? []).catch(() => {});
    handleCustomItemsHash(keyId, (hello as HelloMessage & { custom_items_hash?: string }).custom_items_hash).catch(() => {});
    if (!assetsDone(hello.minecraft_version)) {
      ensureAssets(hello.minecraft_version).catch((err) =>
        console.error("[mc-assets] Background download failed:", err),
      );
    }

    const latestHash = await computeAllPacksHash(keyId);
    const needsSync = latestHash !== "" && latestHash !== hello.current_bundle_hash;

    // With 1:1 ownership, "bound projects" = projects owned by this server_key (non-deleted)
    const boundProjects = await db.select().from(projects).where(
      and(eq(projects.serverKeyId, keyId), isNull(projects.deletedAt)),
    );
    const deletedRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.serverKeyId, keyId), isNotNull(projects.deletedAt)));
    const deletedProjectIds = deletedRows.map((r) => r.id);

    // Build project_hashes via branch → commit content hash (Phase 2).
    // Each project's binding branch is always "main" in the 1:1 model.
    const bindings = boundProjects.map((p) => ({ projectId: p.id, branchName: "main" as const }));

    const projectHashesMap: Record<string, string> = {};
    for (const b of bindings) {
      const branch = await db.select().from(projectBranches).where(and(
        eq(projectBranches.projectId, b.projectId), eq(projectBranches.name, b.branchName),
      ));
      if (branch.length === 0) continue;
      const cmt = await db.select({ contentHash: projectCommits.contentHash })
        .from(projectCommits)
        .where(eq(projectCommits.id, branch[0].headCommitId));
      if (cmt.length === 0) continue;
      projectHashesMap[b.projectId] = cmt[0].contentHash;
    }

    // Create minimal stubs for projects the plugin has on disk but the backend doesn't know about.
    const knownProjectIds = new Set(boundProjects.map((p) => p.id));
    const localProjectIds = hello.local_project_ids ?? [];
    const missingProjectIds = localProjectIds.filter((id) => !knownProjectIds.has(id));
    if (missingProjectIds.length > 0) {
      const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, keyId));
      const sk = skRows[0];
      if (sk) {
        for (const pid of missingProjectIds) {
          await createProject({ networkId: sk.networkId, serverKeyId: keyId, name: pid, id: pid });
          // Advertise the fresh (empty) stub in THIS ack so the plugin's
          // backendHash.isEmpty() auto-push fires on the first connect — without
          // it, the stub is missing from project_hashes and the plugin treats the
          // project as local-only (no upload) until a later reconnect.
          projectHashesMap[pid] = "";
        }
      }
    }

    const rp = await currentPackInfo(keyId);

    const skRow = (await db.select().from(serverKeys).where(eq(serverKeys.id, keyId)))[0];
    let networkName = "";
    let serverUrl = EDITOR_URL;
    if (skRow) {
      const netRow = (await db.select().from(networks).where(eq(networks.id, skRow.networkId)))[0];
      networkName = netRow?.name ?? "";
      if (netRow) {
        serverUrl = `${EDITOR_URL}/networks/${netRow.slug ?? netRow.id}/servers/${skRow.slug ?? skRow.id}`;
      }
    }

    const ack: HelloAckMessage = {
      type: "hello_ack",
      session_id: sessionId,
      server_id: keyId,
      tier: "free",
      needs_sync: needsSync,
      latest_bundle_hash: latestHash,
      api_url: API_BASE_URL,
      bundle_url: BUNDLE_BASE_URL,
      editor_url: EDITOR_URL,
      server_url: serverUrl,
      network_name: networkName,
      project_hashes: projectHashesMap,
      deleted_project_ids: deletedProjectIds,
      resource_pack: rp,
    };

    const push: string[] = [];
    if (needsSync) {
      for (const b of bindings) {
        const hash = projectHashesMap[b.projectId];
        if (!hash) continue;
        const available: BundleAvailableMessage = {
          type: "bundle_available",
          project_id: b.projectId,
          url: `${BUNDLE_BASE_URL}/api/v1/bundles/${b.projectId}?branch=${encodeURIComponent(b.branchName)}`,
          hash,
          signature: "",
        };
        push.push(JSON.stringify(available));
      }
    }

    return { reply: JSON.stringify(ack), sessionId, push };
  }

  if (msg.type === "pong") return { reply: null };

  // ── modules_changed: runtime module registration after hello ─────────────
  if (msg.type === "modules_changed") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const m = msg as ModulesChangedMessage;
    persistServerModules(serverId, m.installed_modules ?? []).catch(() => {});
    persistServerDataSources(serverId, m.data_sources ?? []).catch(() => {});
    return { reply: null };
  }

  // ── pack_divergence_detected: no-op (Plan 1C: backend-as-truth) ──────────
  if (msg.type === "pack_divergence_detected") {
    return { reply: null };
  }

  // ── local_push: plugin pushes local project files to backend (/artisan pushLocal) ─
  if (msg.type === "local_push") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const raw = msg as Record<string, unknown>;
    const projectId = raw.project_id as string | undefined;
    const files = raw.files as Record<string, string> | undefined;
    const hash = raw.hash as string | undefined;
    if (!projectId || !files || !hash) return { reply: null };

    const sk = (await db.select().from(serverKeys).where(eq(serverKeys.id, serverId)))[0];
    if (!sk) return { reply: null };

    let project = await getProject(projectId);
    if (!project) {
      project = await createProject({ networkId: sk.networkId, serverKeyId: serverId, name: projectId, id: projectId });
    }
    const patch: { hash: string; filesJson: string; editorJson?: string } = {
      hash, filesJson: JSON.stringify(files),
    };
    // Contenu poussé par le plugin (bootstrap Add-on / scénario FTP) : si le
    // project n'a jamais été édité (stub), construire l'état éditeur depuis
    // les fichiers pour qu'il soit éditable — jamais quand un vrai état existe.
    if (isEmptyStub(project.editorJson)) {
      patch.editorJson = JSON.stringify(importProjectFromFiles(projectId, files));
    }
    await upsertProjectContent(projectId, patch);
    // local_push = commit sur main + advance head, comme le deploy : le plugin
    // télécharge les bundles via branche → head commit. Sans commit, le download
    // servirait le commit initial vide et le sweep détruirait le contenu local
    // (trouvé au smoke test Docker 2026-07-09). Même convention que le deploy :
    // bundle_available porte le contentHash du commit.
    const mainBranch = await getBranch(projectId, "main");
    if (mainBranch) {
      const editorJson = patch.editorJson ?? project.editorJson;
      const commit = await createCommit({
        projectId,
        parentId: mainBranch.headCommitId,
        files,
        editor: editorJson ? JSON.parse(editorJson) : null,
        authorUserId: null,
        message: "local_push",
      });
      await advanceBranchHead(projectId, "main", commit.id);
      await pushBundleAvailable(projectId, "main", commit.contentHash);
    } else {
      await pushBundleAvailable(projectId, "main", hash);
    }
    return { reply: null };
  }

  // ── custom_items_changed: plugin hot-reload triggered a hash change ───────
  if (msg.type === "custom_items_changed") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const changed = msg as CustomItemsChangedMessage;
    await handleCustomItemsHash(serverId, changed.hash);
    return { reply: null };
  }

  // ── custom_items_bundle: plugin sends compressed bundle ───────────────────
  if (msg.type === "custom_items_bundle") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const bundle = msg as CustomItemsBundleMessage;
    const cacheDir = customItemsCacheDir(serverId);
    try {
      await processBundle(cacheDir, bundle.hash, bundle.data);
    } catch (err) {
      console.error(`[custom-items] Failed to process bundle for server ${serverId}:`, err);
    }
    return { reply: null };
  }

  // ── data_source_fetch_result: resolve a pending preview request ──────────
  if (msg.type === "data_source_fetch_result") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const result = msg as DataSourceFetchResultMessage;
    pendingFetches.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }

  // ── unknown message type: log and ignore ──────────────────────────────────
  console.debug(
    `[hub] unknown message type '${(msg as any).type}' from conn ${connId} ` +
    `(protocol_version=${(msg as any).protocol_version ?? "?"}). Ignoring.`,
  );
  return { reply: null };
}

export async function pushBundleAvailable(
  projectId: string,
  branchName: string,
  contentHash: string,
): Promise<void> {
  // Find the server_key that owns this project (1:1 via projects.serverKeyId).
  const targets = await db
    .select({ serverKeyId: projects.serverKeyId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (targets.length === 0) return;

  const url = `${BUNDLE_BASE_URL}/api/v1/bundles/${projectId}?branch=${encodeURIComponent(branchName)}`;
  const payload = JSON.stringify({
    type: "bundle_available",
    project_id: projectId,
    url,
    hash: contentHash,
    signature: "",
  } satisfies BundleAvailableMessage);

  const targetSet = new Set(targets.map((t) => t.serverKeyId));
  for (const [connId, sId] of connToServerId) {
    if (!targetSet.has(sId)) continue;
    const send = connSenders.get(connId);
    if (send) send(payload);
  }
}

export function broadcastDraftUpdate(
  serverKeyId: string,
  projectId: string,
  menuId: string,
  menuYaml: string,
  senderSessionId: string,
): void {
  const payload = JSON.stringify({
    type: "draft_update",
    project_id: projectId,
    menu_id: menuId,
    menu_yaml: menuYaml,
    updated_by: senderSessionId,
  } satisfies EditorDraftUpdateMessage);

  for (const [sessionId, send] of editorSenders) {
    if (sessionId === senderSessionId) continue;
    if (!editorTokenToServers.get(sessionId)?.has(serverKeyId)) continue;
    send(payload);
  }

  for (const [connId, sId] of connToServerId) {
    if (sId !== serverKeyId) continue;
    const send = connSenders.get(connId);
    if (send) send(JSON.stringify({
      type: "draft_update",
      project_id: projectId,
      menu_id: menuId,
      menu_yaml: menuYaml,
    }));
  }
}

export function pushModuleEvent(
  serverKeyId: string,
  event: { kind: "config_reload"; module_id: string } | { kind: "data_reload"; data_source_ref: string },
): void {
  const payload = JSON.stringify({ type: "module_event", payload: event });
  for (const [sessionId, send] of editorSenders) {
    if (!editorTokenToServers.get(sessionId)?.has(serverKeyId)) continue;
    send(payload);
  }
}

export async function getMcVersion(serverKeyId: string): Promise<string | undefined> {
  const cached = serverIdToMcVersion.get(serverKeyId);
  if (cached) return cached;
  const rows = await db.select({ lastMcVersion: serverKeys.lastMcVersion }).from(serverKeys).where(eq(serverKeys.id, serverKeyId));
  const persisted = rows[0]?.lastMcVersion ?? undefined;
  if (persisted) serverIdToMcVersion.set(serverKeyId, persisted);
  return persisted;
}

export function pushResourcePackUpdated(serverKeyId: string, url: string, hash: string): void {
  const payload = JSON.stringify({
    type: "resource_pack_updated",
    url,
    hash,
  } satisfies ResourcePackUpdatedMessage);
  for (const [connId, sId] of connToServerId) {
    if (sId !== serverKeyId) continue;
    const send = connSenders.get(connId);
    if (send) send(payload);
  }
}

export async function pushProjectDeleted(projectId: string): Promise<void> {
  // In the 1:1 model, each project has exactly one owning server_key via projects.serverKeyId
  const rows = await db.select({ serverKeyId: projects.serverKeyId }).from(projects).where(eq(projects.id, projectId));
  const targets = rows.map((r) => r.serverKeyId);
  if (targets.length === 0) return;
  const payload = JSON.stringify({ type: "project_deleted", project_id: projectId });
  const targetSet = new Set(targets);
  // Push to plugin connections for each server_key bound to this project.
  for (const [connId, sId] of connToServerId) {
    if (!targetSet.has(sId)) continue;
    const send = connSenders.get(connId);
    if (send) send(payload);
  }
  // Push to editor connections (so other open tabs close the project view).
  for (const [sessionId, sIds] of editorTokenToServers) {
    let match = false;
    for (const sId of sIds) if (targetSet.has(sId)) { match = true; break; }
    if (!match) continue;
    const send = editorSenders.get(sessionId);
    if (send) send(payload);
  }
}
