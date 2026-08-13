import { and, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import { db } from "../db/index";
import { ensureAssets, assetsDone } from "../lib/mcAssets";
import { networks, projectBranches, projectCommits, projects, serverKeyHelloes, serverKeys, serverModules, serverDataSources, serverDeclaredModels, serverEditorScreens } from "../db/schema";
import {
  createProject,
  ensureProjectForServer,
  getProject,
  getProjectForServer,
  projectDiskId,
  upsertProjectContent,
} from "../lib/projectStorage";
import { getBranch, advanceBranchHead } from "../lib/branchStorage";
import { createCommit, computeContentHash } from "../lib/commitStorage";
import { computeAllPacksHash } from "../lib/hashUtils";
import { customItemsCacheDir, readCustomItemsHash, processBundle } from "../lib/customItems";
import { applyBoutiqueAdditem, type BoutiqueAdditemPayload } from "../modules/boutique/index";
import { currentPackInfo } from "../lib/resourcePack";
import { invalidateCustomBundle } from "../routes/modelBundle";
import type {
  BundleAvailableMessage,
  CustomItemsBundleMessage,
  CustomItemsChangedMessage,
  CustomItemsRequestMessage,
  ConfigReadMessage,
  ConfigReadResultMessage,
  ProjectReadMessage,
  ProjectReadResultMessage,
  ProjectWriteMessage,
  ProjectWriteResultMessage,
  ConfigWriteMessage,
  ConfigWriteResultMessage,
  DataSourceFetchMessage,
  DataSourceFetchResultMessage,
  OnlinePlayersFetchMessage,
  OnlinePlayersResultMessage,
  PlayerInventoryFetchMessage,
  PlayerInventoryResultMessage,
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

// ── player inventory snapshot: same correlated request/response pattern ─────
export type PlayerInventoryOutcome =
  | { kind: "result"; result: PlayerInventoryResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

const pendingInventoryFetches = new Map<string, (outcome: PlayerInventoryOutcome) => void>();

/**
 * Ask the live plugin bound to `serverKeyId` for a snapshot of `player`'s
 * inventory (capture panel — ADR captured-items-and-module-field-kit). Same
 * offline/timeout semantics as {@link requestDataSourceFetch}.
 */
export function requestPlayerInventory(
  serverKeyId: string,
  player: string,
  timeoutMs: number = DATA_SOURCE_FETCH_TIMEOUT_MS,
): Promise<PlayerInventoryOutcome> {
  let send: ((msg: string) => void) | undefined;
  for (const [cId, sId] of connToServerId) {
    if (sId === serverKeyId) { send = connSenders.get(cId); if (send) break; }
  }
  if (!send) return Promise.resolve({ kind: "offline" });

  const requestId = crypto.randomUUID();
  const msg: PlayerInventoryFetchMessage = {
    type: "player_inventory_fetch",
    request_id: requestId,
    player,
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingInventoryFetches.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingInventoryFetches.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingInventoryFetches.delete(requestId);
      resolve(outcome);
    });
    send(JSON.stringify(msg));
  });
}

// ── online players: same correlated request/response pattern ───────────────
export type OnlinePlayersOutcome =
  | { kind: "result"; result: OnlinePlayersResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

const pendingPlayerListFetches = new Map<string, (outcome: OnlinePlayersOutcome) => void>();

/**
 * Ask the live plugin bound to `serverKeyId` who is connected. Feeds the
 * editor's player pickers; same offline/timeout semantics as
 * {@link requestDataSourceFetch}.
 */
export function requestOnlinePlayers(
  serverKeyId: string,
  timeoutMs: number = DATA_SOURCE_FETCH_TIMEOUT_MS,
): Promise<OnlinePlayersOutcome> {
  let send: ((msg: string) => void) | undefined;
  for (const [cId, sId] of connToServerId) {
    if (sId === serverKeyId) { send = connSenders.get(cId); if (send) break; }
  }
  if (!send) return Promise.resolve({ kind: "offline" });

  const requestId = crypto.randomUUID();
  const msg: OnlinePlayersFetchMessage = { type: "online_players_fetch", request_id: requestId };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingPlayerListFetches.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingPlayerListFetches.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingPlayerListFetches.delete(requestId);
      resolve(outcome);
    });
    send(JSON.stringify(msg));
  });
}

// ── Config screens live channel: same correlated request/response pattern ───
// (ADR module-config-screens — the editor reads/writes table files through us;
// nothing is stored backend-side, we are a pure relay.)
export const CONFIG_WRITE_TIMEOUT_MS = 10_000;

export type ConfigReadOutcome =
  | { kind: "result"; result: ConfigReadResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

export type ConfigWriteOutcome =
  | { kind: "result"; result: ConfigWriteResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

export type ProjectReadOutcome =
  | { kind: "result"; result: ProjectReadResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

export type ProjectWriteOutcome =
  | { kind: "result"; result: ProjectWriteResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

const pendingProjectReads = new Map<string, (outcome: ProjectReadOutcome) => void>();
const pendingProjectWrites = new Map<string, (outcome: ProjectWriteOutcome) => void>();
const pendingConfigReads = new Map<string, (outcome: ConfigReadOutcome) => void>();
const pendingConfigWrites = new Map<string, (outcome: ConfigWriteOutcome) => void>();

function firstPluginSender(serverKeyId: string): ((msg: string) => void) | undefined {
  for (const [cId, sId] of connToServerId) {
    if (sId === serverKeyId) {
      const send = connSenders.get(cId);
      if (send) return send;
    }
  }
  return undefined;
}

/**
 * Read a Project's whole file tree live from the server's disk.
 *
 * The Project *is* those files (ADR `server-disk-only-storage`) — there is no
 * backend copy to fall back on, so an offline server means the Project cannot be
 * opened at all, and the caller must say so rather than serve something stale.
 */
export function requestProjectRead(
  serverKeyId: string,
  req: { projectId: string },
  timeoutMs: number = DATA_SOURCE_FETCH_TIMEOUT_MS,
): Promise<ProjectReadOutcome> {
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });
  const requestId = crypto.randomUUID();
  const msg: ProjectReadMessage = {
    type: "project_read",
    request_id: requestId,
    project_id: req.projectId,
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingProjectReads.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingProjectReads.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingProjectReads.delete(requestId);
      resolve(outcome);
    });
    send(JSON.stringify(msg));
  });
}

/**
 * Write a Project's files to the server's disk through the plugin.
 *
 * We relay, we do not store: the plugin owns the compare-and-swap and the trash,
 * so a stale save comes back as `conflict` with the disk content attached.
 */
export function requestProjectWrite(
  serverKeyId: string,
  req: {
    projectId: string;
    files: { path: string; content: string; base_hash: string | null }[];
    deletes?: { path: string; base_hash: string | null }[];
  },
  timeoutMs: number = CONFIG_WRITE_TIMEOUT_MS,
): Promise<ProjectWriteOutcome> {
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });
  const requestId = crypto.randomUUID();
  const msg: ProjectWriteMessage = {
    type: "project_write",
    request_id: requestId,
    project_id: req.projectId,
    files: req.files,
    deletes: req.deletes ?? [],
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingProjectWrites.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingProjectWrites.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingProjectWrites.delete(requestId);
      resolve(outcome);
    });
    send(JSON.stringify(msg));
  });
}

/** Read the files of a Config-screen table live from the plugin's disk. */
export function requestConfigRead(
  serverKeyId: string,
  req: { projectId: string; table: string },
  timeoutMs: number = DATA_SOURCE_FETCH_TIMEOUT_MS,
): Promise<ConfigReadOutcome> {
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });
  const requestId = crypto.randomUUID();
  const msg: ConfigReadMessage = {
    type: "config_read",
    request_id: requestId,
    project_id: req.projectId,
    table: req.table,
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingConfigReads.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingConfigReads.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingConfigReads.delete(requestId);
      resolve(outcome);
    });
    send(JSON.stringify(msg));
  });
}

/** Write Config-screen files to the plugin's disk (it hot-reloads + auto-pushes). */
export function requestConfigWrite(
  serverKeyId: string,
  req: { projectId: string; files: { path: string; content: string }[]; deletes?: string[] },
  timeoutMs: number = CONFIG_WRITE_TIMEOUT_MS,
): Promise<ConfigWriteOutcome> {
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });
  const requestId = crypto.randomUUID();
  const msg: ConfigWriteMessage = {
    type: "config_write",
    request_id: requestId,
    project_id: req.projectId,
    files: req.files,
    deletes: req.deletes ?? [],
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingConfigWrites.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingConfigWrites.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingConfigWrites.delete(requestId);
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

/**
 * Same semantics as persistServerDataSources, for module-declared Data models
 * (ADR composable-data-models §4): model/v1 documents stored verbatim, keyed
 * by (serverKeyId, model id), pruned to the report.
 */
export async function persistServerDeclaredModels(
  serverKeyId: string,
  reported: Record<string, unknown>[],
): Promise<void> {
  const now = new Date();
  const valid = reported.filter((d) => typeof d.id === "string" && (d.id as string).includes(":"));
  for (const doc of valid) {
    await db
      .insert(serverDeclaredModels)
      .values({
        serverKeyId,
        modelId: doc.id as string,
        documentJson: JSON.stringify(doc),
        reportedAt: now,
      })
      .onConflictDoUpdate({
        target: [serverDeclaredModels.serverKeyId, serverDeclaredModels.modelId],
        set: { documentJson: JSON.stringify(doc), reportedAt: now },
      });
  }
  const keepIds = valid.map((d) => d.id as string);
  await db
    .delete(serverDeclaredModels)
    .where(
      keepIds.length > 0
        ? and(eq(serverDeclaredModels.serverKeyId, serverKeyId), notInArray(serverDeclaredModels.modelId, keepIds))
        : eq(serverDeclaredModels.serverKeyId, serverKeyId),
    );
}

/**
 * Same semantics, for module-declared Config screens (ADR module-config-screens):
 * wire objects stored verbatim, keyed by (serverKeyId, screen id), pruned to the report.
 */
export async function persistServerEditorScreens(
  serverKeyId: string,
  reported: Record<string, unknown>[],
): Promise<void> {
  const now = new Date();
  const valid = reported.filter(
    (s) =>
      typeof s.id === "string" && (s.id as string).includes(":") &&
      typeof s.label === "string" && typeof s.table === "string" &&
      typeof s.project_id === "string",
  );
  for (const screen of valid) {
    await db
      .insert(serverEditorScreens)
      .values({
        serverKeyId,
        screenId: screen.id as string,
        screenJson: JSON.stringify(screen),
        reportedAt: now,
      })
      .onConflictDoUpdate({
        target: [serverEditorScreens.serverKeyId, serverEditorScreens.screenId],
        set: { screenJson: JSON.stringify(screen), reportedAt: now },
      });
  }
  const keepIds = valid.map((s) => s.id as string);
  await db
    .delete(serverEditorScreens)
    .where(
      keepIds.length > 0
        ? and(eq(serverEditorScreens.serverKeyId, serverKeyId), notInArray(serverEditorScreens.screenId, keepIds))
        : eq(serverEditorScreens.serverKeyId, serverKeyId),
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
    persistServerDeclaredModels(keyId, (hello as Record<string, unknown>).declared_models as Record<string, unknown>[] ?? []).catch(() => {});
    persistServerEditorScreens(keyId, (hello as Record<string, unknown>).editor_screens as Record<string, unknown>[] ?? []).catch(() => {});
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
    // `diskId` is what the plugin knows; `projectId` is the internal row id the
    // branch/commit tables key on. They differ only when another server already
    // claimed the disk id (see ensureProjectForServer).
    const bindings = boundProjects.map((p) => ({
      projectId: p.id,
      diskId: projectDiskId(p),
      branchName: "main" as const,
    }));

    const projectHashesMap: Record<string, string> = {};
    for (const b of bindings) {
      const branch = await db.select().from(projectBranches).where(and(
        eq(projectBranches.projectId, b.projectId), eq(projectBranches.name, b.branchName),
      ));
      if (branch.length === 0) continue;
      const cmt = await db.select({ filesJson: projectCommits.filesJson })
        .from(projectCommits)
        .where(eq(projectCommits.id, branch[0].headCommitId));
      if (cmt.length === 0) continue;
      // Recompute canonically from the head's files rather than trusting the
      // stored contentHash: commits created before the canonicalization fix
      // (full-path keys, `.artisan*` included) carry legacy hashes — this
      // self-heals them without a backfill.
      // Keyed by the disk id: `project_hashes` is compared against the plugin's
      // own on-disk hashes, and the file paths it hashes carry the disk id.
      projectHashesMap[b.diskId] = computeContentHash(
        JSON.parse(cmt[0].filesJson) as Record<string, string>, b.diskId,
      );
    }

    // Create minimal stubs for projects the plugin has on disk but the backend doesn't know about.
    const knownProjectIds = new Set(boundProjects.map((p) => projectDiskId(p)));
    const localProjectIds = hello.local_project_ids ?? [];
    const missingProjectIds = localProjectIds.filter((id) => !knownProjectIds.has(id));
    if (missingProjectIds.length > 0) {
      const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, keyId));
      const sk = skRows[0];
      if (sk) {
        for (const pid of missingProjectIds) {
          // Server-scoped: `createProject` is idempotent on the *internal* id, so
          // a global create here handed this server another tenant's project
          // instead of making its own (incident 2026-08-12).
          await ensureProjectForServer({ networkId: sk.networkId, serverKeyId: keyId, diskId: pid });
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
        const hash = projectHashesMap[b.diskId];
        if (!hash) continue;
        const available: BundleAvailableMessage = {
          type: "bundle_available",
          project_id: b.diskId,
          url: `${BUNDLE_BASE_URL}/api/v1/bundles/${b.diskId}?branch=${encodeURIComponent(b.branchName)}`,
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
    persistServerDeclaredModels(serverId, (m as unknown as Record<string, unknown>).declared_models as Record<string, unknown>[] ?? []).catch(() => {});
    persistServerEditorScreens(serverId, (m as unknown as Record<string, unknown>).editor_screens as Record<string, unknown>[] ?? []).catch(() => {});
    return { reply: null };
  }

  // ── sync_divergence: disk AND web both moved — plugin reports its disk tree ─
  // (files-first P3c). Stored IN MEMORY only: the plugin re-reports at every
  // hello_ack while unresolved, so a backend restart self-heals on reconnect.
  if (msg.type === "sync_divergence") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const raw = msg as Record<string, unknown>;
    const projectId = raw.project_id as string | undefined;
    const files = raw.files as Record<string, string> | undefined;
    const diskHash = raw.disk_hash as string | undefined;
    if (!projectId || !files || typeof diskHash !== "string") return { reply: null };
    // The plugin reports its disk id; the map (and the editor that reads it) is
    // keyed by the internal row id, the only id unique across servers.
    const divergent = await getProjectForServer(serverId, projectId);
    if (!divergent) return { reply: null };
    pendingDivergences.set(divergent.id, { files, diskHash, at: new Date().toISOString() });
    // Nudge open editor tabs on this server key — they refetch the project
    // (GET includes the divergence detail) and show the resolution banner.
    const payload = JSON.stringify({ type: "sync_divergence", project_id: divergent.id, disk_hash: diskHash });
    for (const [sessionId, sIds] of editorTokenToServers) {
      if (!sIds.has(serverId)) continue;
      editorSenders.get(sessionId)?.(payload);
    }
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

    // `projectId` is the pushing server's DISK id and is NOT globally unique —
    // every Boutique install bootstraps `boutique_shop`. Resolving it globally
    // (getProject) made one server's push land in another tenant's project;
    // combined with createProject's idempotence-on-id, the collision was silent
    // rather than a duplicate-key error (incident 2026-08-12).
    const project = await ensureProjectForServer({
      networkId: sk.networkId,
      serverKeyId: serverId,
      diskId: projectId,
    });
    // The plugin never uploads `.artisan/*` metadata (hash-excluded editor
    // state, e.g. `.artisan/editor.yaml`) — preserve the backend's copies so a
    // disk push doesn't strip the board layout from the stored file tree.
    if (project.filesJson) {
      const prev = JSON.parse(project.filesJson) as Record<string, string>;
      const metaPrefix = `plugins/Artisan/projects/${projectId}/.artisan`;
      for (const [k, v] of Object.entries(prev)) {
        if (k.startsWith(metaPrefix) && !(k in files)) files[k] = v;
      }
    }
    // Files-first: the pushed file tree IS the new project content — no editor
    // JSON to derive or patch (the editor parses files client-side; ownerModule
    // lives in the manifest and is re-read on every load).
    await upsertProjectContent(project.id, { hash, filesJson: JSON.stringify(files) });
    // local_push = commit sur main + advance head, comme le deploy : le plugin
    // télécharge les bundles via branche → head commit. Sans commit, le download
    // servirait le commit initial vide et le sweep détruirait le contenu local
    // (trouvé au smoke test Docker 2026-07-09). Même convention que le deploy :
    // bundle_available porte le contentHash du commit.
    const mainBranch = await getBranch(project.id, "main");
    if (mainBranch) {
      const commit = await createCommit({
        projectId: project.id,
        parentId: mainBranch.headCommitId,
        files,
        authorUserId: null,
        message: "local_push",
      });
      await advanceBranchHead(project.id, "main", commit.id);
      await pushBundleAvailable(project.id, "main", commit.contentHash);
    } else {
      await pushBundleAvailable(project.id, "main", hash);
    }
    // A manual pushLocal is a "force disk" resolution — clear any pending divergence.
    clearPendingDivergence(project.id, serverId);
    return { reply: null };
  }

  // ── boutique_additem: /boutique additem — backend-module mutation ─────────
  // ADR captured-items-and-module-field-kit §3: the plugin never writes project
  // files; the boutique backend module patches the project's file tree +
  // commits, then we broadcast so the server hot-reloads.
  if (msg.type === "boutique_additem") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const raw = msg as unknown as { request_id?: string } & BoutiqueAdditemPayload;
    const result = await applyBoutiqueAdditem(serverId, raw);
    if (result.ok) await pushBundleAvailable(result.projectId, "main", result.contentHash);
    return {
      reply: JSON.stringify({
        type: "boutique_additem_result",
        request_id: raw.request_id ?? null,
        ok: result.ok,
        ...(result.ok ? {} : { error: result.error }),
      }),
    };
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
      // Sans ça le backend continue de servir les anciens modèles jusqu'au
      // redémarrage : le cache est keyé sur le seul serverKeyId.
      invalidateCustomBundle(serverId);
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

  // ── online_players_result: resolve a pending player listing ───────────────
  if (msg.type === "online_players_result") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const result = msg as unknown as OnlinePlayersResultMessage;
    pendingPlayerListFetches.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }

  // ── player_inventory_result: resolve a pending inventory snapshot ─────────
  if (msg.type === "player_inventory_result") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const result = msg as PlayerInventoryResultMessage;
    pendingInventoryFetches.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }

  // ── project_read_result: the editor's read of a Project (disk-only store) ──
  if (msg.type === "project_read_result") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const result = msg as ProjectReadResultMessage;
    pendingProjectReads.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }

  if (msg.type === "project_write_result") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const result = msg as ProjectWriteResultMessage;
    pendingProjectWrites.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }

  // ── config_read_result / config_write_result: Config screens live channel ──
  if (msg.type === "config_read_result") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const result = msg as ConfigReadResultMessage;
    pendingConfigReads.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }
  if (msg.type === "config_write_result") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const result = msg as ConfigWriteResultMessage;
    pendingConfigWrites.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }

  // ── unknown message type: log and ignore ──────────────────────────────────
  console.debug(
    `[hub] unknown message type '${(msg as any).type}' from conn ${connId} ` +
    `(protocol_version=${(msg as any).protocol_version ?? "?"}). Ignoring.`,
  );
  return { reply: null };
}

// ── pending sync divergences (files-first P3c) ──────────────────────────────
// projectId → the plugin-reported disk tree. Memory-only by design: the plugin
// re-reports at every hello_ack while unresolved (self-healing across backend
// restarts); resolution (or a manual pushLocal) clears it.

export interface PendingDivergence {
  files: Record<string, string>;
  diskHash: string;
  at: string;
}
const pendingDivergences = new Map<string, PendingDivergence>();

export function getPendingDivergence(projectId: string): PendingDivergence | undefined {
  return pendingDivergences.get(projectId);
}

/** Drop a pending divergence and tell open editor tabs the banner can go. */
export function clearPendingDivergence(projectId: string, serverKeyId?: string): void {
  if (!pendingDivergences.delete(projectId)) return;
  const payload = JSON.stringify({ type: "divergence_resolved", project_id: projectId });
  for (const [sessionId, sIds] of editorTokenToServers) {
    if (serverKeyId && !sIds.has(serverKeyId)) continue;
    editorSenders.get(sessionId)?.(payload);
  }
}

export async function pushBundleAvailable(
  projectId: string,
  branchName: string,
  contentHash: string,
  // force: the plugin downloads even over local disk changes — reserved for
  // divergence resolution, where the merged tree is the explicit intent.
  opts?: { force?: boolean },
): Promise<void> {
  // Find the server_key that owns this project (1:1 via projects.serverKeyId).
  const targets = await db
    .select({ serverKeyId: projects.serverKeyId, id: projects.id, externalId: projects.externalId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (targets.length === 0) return;

  // On the wire the plugin only ever knows its own disk id.
  const diskId = projectDiskId(targets[0]);
  const url = `${BUNDLE_BASE_URL}/api/v1/bundles/${diskId}?branch=${encodeURIComponent(branchName)}`;
  const payload = JSON.stringify({
    type: "bundle_available",
    project_id: diskId,
    url,
    hash: contentHash,
    signature: "",
    ...(opts?.force ? { force: true } : {}),
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
  const rows = await db.select({ serverKeyId: projects.serverKeyId, id: projects.id, externalId: projects.externalId }).from(projects).where(eq(projects.id, projectId));
  const targets = rows.map((r) => r.serverKeyId);
  if (targets.length === 0) return;
  // Two audiences, two ids: the plugin move-to-trashes a directory named after
  // its disk id, the editor addresses the internal row.
  const pluginPayload = JSON.stringify({ type: "project_deleted", project_id: projectDiskId(rows[0]) });
  const payload = JSON.stringify({ type: "project_deleted", project_id: projectId });
  const targetSet = new Set(targets);
  // Push to plugin connections for each server_key bound to this project.
  for (const [connId, sId] of connToServerId) {
    if (!targetSet.has(sId)) continue;
    const send = connSenders.get(connId);
    if (send) send(pluginPayload);
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
