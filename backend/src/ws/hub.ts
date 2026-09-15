import { and, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import type { DraftRequest } from "../lib/storage/ServerDraftStore";
import type { DraftOutcome, DraftResult } from "../lib/storage/DraftStore";
import { db } from "../db/index";
import { addConsoleMember } from "../lib/consoleAccess";
import { forgetProjectTree } from "../lib/projectTreeReads";
import { completeProjectRename, failProjectRename, isTerminalRenameError, pendingProjectRenames, projectIdentityLocked, reconcileProjectIdentity, type ProjectIdentityReport } from "../lib/projectRename";
import type { ProjectRenameMessage, ProjectRenameResultMessage, ProjectCopyMessage, ProjectCopyResultMessage } from "../protocol";
import { ensureAssets, assetsDone } from "../lib/mcAssets";
import { networks, projects, projectCopies, serverKeyHelloes, serverKeys, serverModules, serverDataSources, serverDeclaredModels, serverEditorScreens } from "../db/schema";
import {
  createProject,
  ensureProjectForServer,
  getProject,
  getProjectForServer,
  projectDiskId,
} from "../lib/projectStorage";
import { customItemsCacheDir, readCustomItemsHash, processBundle } from "../lib/customItems";
import { currentPackInfo } from "../lib/resourcePack";
import { invalidateCustomBundle } from "../routes/modelBundle";
import type {
  HeadTextureResultMessage,
  EditorProjectsReloadedMessage,
  ProjectsReloadedMessage,
  CustomItemsBundleMessage,
  CustomItemsChangedMessage,
  CustomItemsRequestMessage,
  ConfigReadMessage,
  ConfigReadResultMessage,
  AssetReadMessage,
  AssetReadResultMessage,
  AssetWriteMessage,
  AssetWriteResultMessage,
  ProjectReadMessage,
  ProjectReadResultMessage,
  ProjectWriteMessage,
  ProjectWriteResultMessage,
  ProjectListMessage,
  ProjectListResultMessage,
  ProjectHistoryMessage,
  ProjectHistoryResultMessage,
  ConfigWriteMessage,
  ConfigWriteResultMessage,
  DataSourceFetchMessage,
  DataSourceFetchResultMessage,
  ImportSourcesListMessage,
  ImportSourcesListResultMessage,
  ImportSourcesReadMessage,
  ImportSourcesReadResultMessage,
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
const serverRenameCapabilities = new Map<string, boolean>();
const draftConnections = new Set<string>();
const mixedWriteConnections = new Set<string>();
const copyConnections = new Map<string, { minecraftVersion: string; modules: string[] }>();
const copyMaintenanceAt = new Map<string, number>();
function scheduleCopyMaintenance(serverKeyId: string) {
  if (Date.now() - (copyMaintenanceAt.get(serverKeyId) ?? 0) < 60_000) return;
  copyMaintenanceAt.set(serverKeyId, Date.now());
  setTimeout(() => { void import("../lib/projectCopy").then(({ resumeServerCopies }) => resumeServerCopies(serverKeyId)).catch(error => console.error("[copies] reconciliation pending", error)); }, 0);
}
export function projectCopyTarget(serverKeyId: string) {
  const id = [...copyConnections.keys()].find(id => connToServerId.get(id) === serverKeyId && connSenders.has(id));
  return id ? copyConnections.get(id) : undefined;
}
export type ProjectCopyOutcome = { kind: "result"; result: ProjectCopyResultMessage } | { kind: "offline" | "timeout" };
const pendingCopies = new Map<string, { connId: string; request: Omit<ProjectCopyMessage, "type" | "request_id">; finish: (outcome: ProjectCopyOutcome) => void }>();
export function requestProjectCopy(serverKeyId: string, request: Omit<ProjectCopyMessage, "type" | "request_id">, timeoutMs = 30_000): Promise<ProjectCopyOutcome> {
  const connId = [...copyConnections.keys()].find(id => connToServerId.get(id) === serverKeyId && connSenders.has(id));
  const send = connId && connSenders.get(connId);
  if (!connId || !send) return Promise.resolve({ kind: "offline" });
  return new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const finish = (outcome: ProjectCopyOutcome) => { clearTimeout(timer); pendingCopies.delete(requestId); resolve(outcome); };
    const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
    pendingCopies.set(requestId, { connId, request, finish });
    try { send(JSON.stringify({ ...request, type: "project_copy", request_id: requestId })); } catch { finish({ kind: "offline" }); }
  });
}
export function supportsMixedProjectWrite(serverKeyId: string) {
  return [...mixedWriteConnections].some((id) => connToServerId.get(id) === serverKeyId && connSenders.has(id));
}
export function supportsProjectDrafts(serverKeyId: string) {
  return [...draftConnections].some((id) => connToServerId.get(id) === serverKeyId && connSenders.has(id));
}
const pendingDrafts = new Map<string, { connId: string; finish: (outcome: DraftOutcome) => void }>();
export async function requestProjectDraft(serverKeyId: string, request: DraftRequest, timeoutMs = 30_000): Promise<DraftOutcome> {
  if (!["list", "list_all", "read", "read_blob"].includes(request.action) && await projectIdentityLocked(serverKeyId, request.project_id)) return { kind: "result", result: { ok: false, error: "rename_in_progress" } };
  const connId = [...draftConnections].find((id) => connToServerId.get(id) === serverKeyId && connSenders.has(id));
  const send = connId ? connSenders.get(connId) : undefined;
  if (!send || !connId) return Promise.resolve({ kind: "offline" });
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const finish = (result: DraftOutcome) => { clearTimeout(timer); pendingDrafts.delete(requestId); resolve(result); };
    const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
    pendingDrafts.set(requestId, { connId, finish });
    try { send(JSON.stringify({ ...request, type: "project_draft_request", request_id: requestId })); }
    catch { finish({ kind: "offline" }); }
  });
}
export function supportsProjectRename(serverKeyId: string) { return serverRenameCapabilities.get(serverKeyId) === true && !!firstPluginSender(serverKeyId); }
export type ProjectRenameOutcome = { kind: "result"; result: ProjectRenameResultMessage } | { kind: "offline" } | { kind: "timeout" };
const pendingRenames = new Map<string, { serverKeyId: string; message: ProjectRenameMessage; resolve: (value: ProjectRenameOutcome) => void }>();

export function requestProjectRename(serverKeyId: string, req: { operationId: string; projectId: string; targetId: string }, timeoutMs = CONFIG_WRITE_TIMEOUT_MS): Promise<ProjectRenameOutcome> {
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });
  const message: ProjectRenameMessage = { type: "project_rename", request_id: crypto.randomUUID(), operation_id: req.operationId, project_id: req.projectId, target_project_id: req.targetId };
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pendingRenames.delete(message.request_id); resolve({ kind: "timeout" }); }, timeoutMs);
    pendingRenames.set(message.request_id, { serverKeyId, message, resolve: (outcome) => { clearTimeout(timer); pendingRenames.delete(message.request_id); resolve(outcome); } });
    try { send(JSON.stringify(message)); }
    catch { clearTimeout(timer); pendingRenames.delete(message.request_id); resolve({ kind: "offline" }); }
  });
}

function announceProjectRename(serverKeyId: string, projectId: string, sourceId: string, targetId: string) {
  forgetProjectTree(serverKeyId, sourceId);
  forgetProjectTree(serverKeyId, targetId);
  const payload = JSON.stringify({ type: "project_renamed", server_key_id: serverKeyId, project_id: projectId, previous_disk_id: sourceId, disk_id: targetId });
  for (const [sessionId, send] of editorSenders) if (editorTokenToServers.get(sessionId)?.has(serverKeyId)) send(payload);
}

export async function reconcileServerProjectIdentity(serverKeyId: string, report: ProjectIdentityReport) {
  if (!report.project_roots?.length && !report.project_rename_results?.length && !report.identity_migrations?.length) return;
  const previous = await db.select().from(projects).where(eq(projects.serverKeyId, serverKeyId));
  await reconcileProjectIdentity(serverKeyId, report);
  const current = await db.select().from(projects).where(eq(projects.serverKeyId, serverKeyId));
  for (const project of current) {
    const before = previous.find((p) => p.id === project.id);
    if (before && projectDiskId(before) !== projectDiskId(project)) announceProjectRename(serverKeyId, project.id, projectDiskId(before), projectDiskId(project));
  }
}

async function resumeProjectRenames(serverKeyId: string) {
  void import("../lib/projectCopy").then(({ resumeServerCopies }) => resumeServerCopies(serverKeyId)).catch(error => console.error("[copies] resume pending", error));
  void import("../lib/projectDraftMigration").then(({ resumeServerDrafts }) => resumeServerDrafts(serverKeyId)).catch((error) => console.error("[drafts] migration pending", error));
  for (const op of await pendingProjectRenames(serverKeyId)) {
    if ([...pendingRenames.values()].some((pending) => pending.serverKeyId === serverKeyId && pending.message.operation_id === op.id)) continue;
    void requestProjectRename(serverKeyId, { operationId: op.id, projectId: op.sourceId, targetId: op.targetId });
  }
}
// serverKeyId → minecraft version (set on hello, used by /api/items)
const serverIdToMcVersion = new Map<string, string>();

export function registerConn(connId: string, send: (msg: string) => void): void {
  connSenders.set(connId, send);
}

export function cleanupConn(connId: string): void {
  copyConnections.delete(connId);
  for (const pending of pendingCopies.values()) if (pending.connId === connId) pending.finish({ kind: "offline" });
  mixedWriteConnections.delete(connId);
  draftConnections.delete(connId);
  for (const pending of pendingDrafts.values()) if (pending.connId === connId) pending.finish({ kind: "offline" });
  connSenders.delete(connId);
  connToServerId.delete(connId);
}

type HeadTextureOutcome =
  | { kind: "result"; result: HeadTextureResultMessage }
  | { kind: "offline" | "timeout" };
const pendingHeadTextures = new Map<string, {
  serverKeyId: string;
  finish: (outcome: HeadTextureOutcome) => void;
}>();

export function requestHeadTexture(serverKeyId: string, id: string, timeoutMs = 5_000): Promise<HeadTextureOutcome> {
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const finish = (outcome: HeadTextureOutcome) => {
      clearTimeout(timer);
      pendingHeadTextures.delete(requestId);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
    pendingHeadTextures.set(requestId, { serverKeyId, finish });
    try { send(JSON.stringify({ type: "head_texture_fetch", request_id: requestId, id })); }
    catch { finish({ kind: "offline" }); }
  });
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

export const IMPORT_SOURCES_LIST_TIMEOUT_MS = 5_000;

export type ImportSourcesListOutcome =
  | { kind: "result"; result: ImportSourcesListResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

const pendingImportSourcesLists = new Map<
  string,
  (outcome: ImportSourcesListOutcome) => void
>();

export const IMPORT_SOURCES_READ_TIMEOUT_MS = 10_000;

export type ImportSourcesReadOutcome =
  | { kind: "result"; result: ImportSourcesReadResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

const pendingImportSourcesReads = new Map<
  string,
  (outcome: ImportSourcesReadOutcome) => void
>();

export function requestImportSourcesList(
  serverKeyId: string,
  timeoutMs: number = IMPORT_SOURCES_LIST_TIMEOUT_MS,
): Promise<ImportSourcesListOutcome> {
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });

  const requestId = crypto.randomUUID();
  const msg: ImportSourcesListMessage = {
    type: "import_sources_list",
    request_id: requestId,
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingImportSourcesLists.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingImportSourcesLists.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingImportSourcesLists.delete(requestId);
      resolve(outcome);
    });
    send(JSON.stringify(msg));
  });
}

export function requestImportSourcesRead(
  serverKeyId: string,
  selections: { source_id: string; paths: string[] }[],
  timeoutMs: number = IMPORT_SOURCES_READ_TIMEOUT_MS,
): Promise<ImportSourcesReadOutcome> {
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });

  const requestId = crypto.randomUUID();
  const msg: ImportSourcesReadMessage = {
    type: "import_sources_read",
    request_id: requestId,
    selections,
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingImportSourcesReads.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingImportSourcesReads.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingImportSourcesReads.delete(requestId);
      resolve(outcome);
    });
    send(JSON.stringify(msg));
  });
}

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

export type AssetReadOutcome =
  | { kind: "result"; result: AssetReadResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

export type AssetWriteOutcome =
  | { kind: "result"; result: AssetWriteResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

const pendingAssetReads = new Map<string, (outcome: AssetReadOutcome) => void>();
const pendingAssetWrites = new Map<string, (outcome: AssetWriteOutcome) => void>();

/**
 * Les octets d'UN asset, à la demande (ADR `assets-on-server-disk`).
 *
 * Canal séparé de `project_read` à dessein : l'arbre part entier à chaque
 * ouverture, en UTF-8. Y verser des binaires en base64 l'enflerait d'un tiers
 * pour un contenu dont l'éditeur n'a besoin qu'au moment de l'afficher.
 */
export function requestAssetRead(
  serverKeyId: string,
  req: { projectId: string; path: string },
  timeoutMs: number = DATA_SOURCE_FETCH_TIMEOUT_MS,
): Promise<AssetReadOutcome> {
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });
  const requestId = crypto.randomUUID();
  const msg: AssetReadMessage = {
    type: "asset_read",
    request_id: requestId,
    project_id: req.projectId,
    path: req.path,
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAssetReads.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingAssetReads.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingAssetReads.delete(requestId);
      resolve(outcome);
    });
    send(JSON.stringify(msg));
  });
}

/** Écriture (ou suppression, `contentBase64` null) d'UN asset, CAS sur `baseHash`. */
export async function requestAssetWrite(
  serverKeyId: string,
  req: {
    projectId: string;
    /** Groupé et tout-ou-rien : une police dépliée, c'est ~96 fichiers. */
    files: { path: string; contentBase64: string | null; baseHash: string | null }[];
  },
  timeoutMs: number = DATA_SOURCE_FETCH_TIMEOUT_MS,
): Promise<AssetWriteOutcome> {
  if (await projectIdentityLocked(serverKeyId, req.projectId)) return { kind: "result", result: { type: "asset_write_result", request_id: "", ok: false, error: "write_error", message: "rename_in_progress" } };
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });
  const requestId = crypto.randomUUID();
  const msg: AssetWriteMessage = {
    type: "asset_write",
    request_id: requestId,
    project_id: req.projectId,
    files: req.files.map((f) => ({
      path: f.path,
      content_base64: f.contentBase64,
      base_hash: f.baseHash,
    })),
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAssetWrites.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingAssetWrites.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingAssetWrites.delete(requestId);
      resolve(outcome);
    });
    send(JSON.stringify(msg));
  });
}

export type ProjectHistoryOutcome =
  | { kind: "result"; result: ProjectHistoryResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

const pendingProjectHistories = new Map<string, (outcome: ProjectHistoryOutcome) => void>();

export type ProjectListOutcome =
  | { kind: "result"; result: ProjectListResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

const pendingProjectLists = new Map<string, (outcome: ProjectListOutcome) => void>();

/**
 * Les Projects présents sur le disque du serveur, maintenant.
 *
 * Le backend n'en tient plus de liste : elle se périme dès qu'un dossier est
 * renommé ou supprimé, et la resynchroniser rejouerait le miroir qu'on a
 * supprimé (ADR `server-disk-only-storage`). Les lignes `projects` subsistent,
 * mais comme **points d'ancrage** de ce que le backend possède vraiment (assets,
 * resource pack, conversations) — plus comme inventaire.
 */
export async function requestProjectList(
  serverKeyId: string,
  timeoutMs: number = DATA_SOURCE_FETCH_TIMEOUT_MS,
): Promise<ProjectListOutcome> {
  await resumeProjectRenames(serverKeyId);
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });
  const requestId = crypto.randomUUID();
  const msg: ProjectListMessage = { type: "project_list", request_id: requestId };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingProjectLists.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingProjectLists.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingProjectLists.delete(requestId);
      resolve(outcome);
    });
    send(JSON.stringify(msg));
  });
}
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
  req: { projectId: string; ifHash?: string | null },
  timeoutMs: number = DATA_SOURCE_FETCH_TIMEOUT_MS,
): Promise<ProjectReadOutcome> {
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });
  const requestId = crypto.randomUUID();
  const msg: ProjectReadMessage = {
    type: "project_read",
    request_id: requestId,
    project_id: req.projectId,
    if_hash: req.ifHash ?? null,
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
export async function requestProjectWrite(
  serverKeyId: string,
  req: {
    projectId: string;
    operationId?: string;
    binaries?: { path: string; content_base64: string | null; base_hash: string | null }[];
    files: { path: string; content: string; base_hash: string | null }[];
    deletes?: { path: string; base_hash: string | null }[];
    renames?: { from: string; to: string; base_hash: string }[];
    create?: boolean;
  },
  timeoutMs: number = CONFIG_WRITE_TIMEOUT_MS,
): Promise<ProjectWriteOutcome> {
  if (await projectIdentityLocked(serverKeyId, req.projectId)) return { kind: "result", result: { type: "project_write_result", request_id: "", ok: false, error: "write_error", message: "rename_in_progress" } };
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });
  if (req.binaries?.length && !supportsMixedProjectWrite(serverKeyId)) return { kind: "result", result: { type: "project_write_result", request_id: "", ok: false, error: "plugin_update_required" } };
  const requestId = crypto.randomUUID();
  const msg: ProjectWriteMessage = {
    type: "project_write",
    request_id: requestId,
    project_id: req.projectId,
    ...(req.operationId ? { operation_id: req.operationId } : {}),
    ...(req.binaries ? { binaries: req.binaries } : {}),
    files: req.files,
    deletes: req.deletes ?? [],
    renames: req.renames ?? [],
    create: req.create ?? false,
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
    try { send(JSON.stringify(msg)); }
    catch { clearTimeout(timer); pendingProjectWrites.delete(requestId); resolve({ kind: "offline" }); }
  });
}

/** Les versions archivées d'un fichier (corbeille disque du plugin). */
export function requestProjectHistory(
  serverKeyId: string,
  req: { projectId: string; path: string },
  timeoutMs: number = DATA_SOURCE_FETCH_TIMEOUT_MS,
): Promise<ProjectHistoryOutcome> {
  const send = firstPluginSender(serverKeyId);
  if (!send) return Promise.resolve({ kind: "offline" });
  const requestId = crypto.randomUUID();
  const msg: ProjectHistoryMessage = {
    type: "project_history",
    request_id: requestId,
    project_id: req.projectId,
    path: req.path,
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingProjectHistories.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingProjectHistories.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingProjectHistories.delete(requestId);
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
export async function requestConfigWrite(
  serverKeyId: string,
  req: { projectId: string; files: { path: string; content: string }[]; deletes?: string[] },
  timeoutMs: number = CONFIG_WRITE_TIMEOUT_MS,
): Promise<ConfigWriteOutcome> {
  if (await projectIdentityLocked(serverKeyId, req.projectId)) return { kind: "result", result: { type: "config_write_result", request_id: "", ok: false, error: "write_error", message: "rename_in_progress" } };
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

const editorOwners = new Map<string, { userId: string; close: () => void }>();

export function disconnectUserEditors(userId: string): void {
  for (const [id, owner] of editorOwners) {
    if (owner.userId !== userId) continue;
    cleanupEditorConn(id);
    try { owner.close(); } catch { /* Already closed. */ }
  }
}

export function registerEditorConn(
  sessionId: string,
  serverKeyIds: string | Set<string>,
  send: (msg: string) => void,
  owner?: { userId: string; close: () => void },
): void {
  if (owner) editorOwners.set(sessionId, owner);
  editorSenders.set(sessionId, send);
  editorTokenToServers.set(sessionId, typeof serverKeyIds === "string" ? new Set([serverKeyIds]) : serverKeyIds);
}

export function cleanupEditorConn(sessionId: string): void {
  editorOwners.delete(sessionId);
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

    // Une clé serveur = UN serveur vivant. Le relais choisit « la première
    // connexion trouvée » : tant que le backend détenait le contenu, parler à
    // l'une ou l'autre instance revenait au même — elles téléchargeaient toutes
    // le même bundle. Depuis `server-disk-only-storage`, chacune a SON disque et
    // rien ne les synchronise, donc une clé partagée fait lire un disque et
    // écrire l'autre, puis basculer en silence quand la première tombe.
    //
    // Dernier arrivé gagne : un serveur qui crashe laisse une connexion morte,
    // et « premier gagne » verrouillerait le vrai serveur dehors jusqu'à
    // expiration du keepalive — au pire moment. Un redémarrage se recolle donc
    // tout seul, et deux serveurs qui se disputent réellement une clé deviennent
    // visibles (déconnexions en boucle) au lieu de diverger en silence.
    for (const [otherConnId, sId] of connToServerId) {
      if (sId !== keyId || otherConnId === connId) continue;
      connToServerId.delete(otherConnId);
      // On le lui dit : sans ça, le serveur évincé se croit connecté
      // indéfiniment et son admin n'a aucun moyen de comprendre son silence.
      connSenders.get(otherConnId)?.(JSON.stringify({
        type: "session_replaced",
        reason: "another server connected with this server key",
      }));
    }

    const sessionId = crypto.randomUUID();
    activeSessions.set(sessionId, keyId);
    connToServerId.set(connId, keyId);
    await db.update(serverKeys).set({ editorAccessMode: hello.editor_access_mode === "console" ? "console" : "invitation" }).where(eq(serverKeys.id, keyId));
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

    // Le backend ne détient plus de contenu : il n'y a ni hash à comparer, ni
    // bundle à annoncer (ADR `server-disk-only-storage`). Il garde en revanche
    // l'IDENTITÉ des Projects — c'est elle qui permet à l'éditeur de les lister
    // et de les router — donc un project présent sur le disque du serveur mais
    // inconnu de la base y est enregistré ici.
    serverRenameCapabilities.set(keyId, hello.capabilities?.includes("project_rename") === true);
    if (hello.capabilities?.includes("project_copy_v1")) copyConnections.set(connId, { minecraftVersion: hello.minecraft_version ?? "", modules: (hello.installed_modules ?? []).map(m => m.id) });
    else copyConnections.delete(connId);
    if (hello.capabilities?.includes("project_drafts_v1")) draftConnections.add(connId);
    else draftConnections.delete(connId);
    if (hello.capabilities?.includes("project_mixed_write_v1")) mixedWriteConnections.add(connId);
    else mixedWriteConnections.delete(connId);
    await reconcileServerProjectIdentity(keyId, hello);
    const boundProjects = await db.select().from(projects).where(
      and(eq(projects.serverKeyId, keyId), isNull(projects.deletedAt)),
    );
    const knownProjectIds = new Set(boundProjects.map((p) => projectDiskId(p)));
    const missingProjectIds = (hello.local_project_ids ?? []).filter((id) => !knownProjectIds.has(id));
    if (missingProjectIds.length > 0) {
      const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, keyId));
      const sk = skRows[0];
      if (sk) {
        for (const pid of missingProjectIds) {
          if (await projectIdentityLocked(keyId, pid)) continue;
          // Server-scoped: `createProject` is idempotent on the *internal* id, so
          // a global create here handed this server another tenant's project
          // instead of making its own (incident 2026-08-12).
          await ensureProjectForServer({ networkId: sk.networkId, serverKeyId: keyId, diskId: pid });
        }
      }
    }
    await reconcileServerProjectIdentity(keyId, { project_roots: hello.project_roots });

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
      api_url: API_BASE_URL,
      editor_url: EDITOR_URL,
      server_url: serverUrl,
      network_name: networkName,
      resource_pack: rp,
    };

    setTimeout(() => { void import("../lib/projectDraftMigration").then(({ resumeServerDrafts }) => resumeServerDrafts(keyId)).catch((error) => console.error("[drafts] migration pending", error)); }, 0);
    // Plus rien à pousser après l'ack : le backend n'annonce plus de bundle.
    scheduleCopyMaintenance(keyId);
    return { reply: JSON.stringify(ack), sessionId, push: [] };
  }

  if (msg.type === "member_add") {
    const request = msg as { type: string; request_id?: unknown; email?: unknown };
    if (typeof request.request_id !== "string" || request.request_id.length > 100) return { reply: null };
    const serverId = connToServerId.get(connId);
    const result = serverId
      ? await addConsoleMember(serverId, request.email, () => connToServerId.get(connId) === serverId)
      : { ok: false, error: "unauthorized" };
    return { reply: JSON.stringify({ type: "member_add_result", request_id: request.request_id, ...result }) };
  }

  if (msg.type === "pong") { const serverId = connToServerId.get(connId); if (serverId) scheduleCopyMaintenance(serverId); return { reply: null }; }

  // ── modules_changed: runtime module registration after hello ─────────────
  if (msg.type === "modules_changed") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const m = msg as ModulesChangedMessage;
    const copyTarget = copyConnections.get(connId);
    if (copyTarget) copyTarget.modules = (m.installed_modules ?? []).map(module => module.id);
    await reconcileServerProjectIdentity(serverId, m);
    persistServerModules(serverId, m.installed_modules ?? []).catch(() => {});
    persistServerDataSources(serverId, m.data_sources ?? []).catch(() => {});
    persistServerDeclaredModels(serverId, (m as unknown as Record<string, unknown>).declared_models as Record<string, unknown>[] ?? []).catch(() => {});
    persistServerEditorScreens(serverId, (m as unknown as Record<string, unknown>).editor_screens as Record<string, unknown>[] ?? []).catch(() => {});
    return { reply: null };
  }

  // sync_divergence / local_push / boutique_additem ont disparu avec le
  // stockage backend (ADR `server-disk-only-storage`) : il n'y a plus de copie
  // à réconcilier, à pousser, ni à patcher. Le plugin écrit son disque lui-même.

  // ── custom_items_changed: plugin hot-reload triggered a hash change ───────
  // ── projects_reloaded: le plugin a relu ses Projects ──────────────────────
  if (msg.type === "projects_reloaded") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    await reconcileServerProjectIdentity(serverId, msg as ProjectsReloadedMessage);
    const projects = (msg as ProjectsReloadedMessage).projects ?? [];
    // Ce qu'on avait mémorisé de ces arbres décrit l'avant-reload.
    for (const p of projects) forgetProjectTree(serverId, p.id);
    // Les éditeurs ouverts sur CE serveur peuvent revalider — et avec
    // l'empreinte, celui qui a déjà cette version n'a rien à faire du tout.
    const payload = JSON.stringify({
      type: "projects_reloaded",
      server_key_id: serverId,
      projects,
    } satisfies EditorProjectsReloadedMessage);
    for (const [sessionId, send] of editorSenders) {
      if (!editorTokenToServers.get(sessionId)?.has(serverId)) continue;
      send(payload);
    }
    return { reply: null };
  }

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

  if (msg.type === "import_sources_list_result") {
    if (!connToServerId.get(connId)) return { reply: null };
    const result = msg as ImportSourcesListResultMessage;
    pendingImportSourcesLists.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }

  if (msg.type === "import_sources_read_result") {
    if (!connToServerId.get(connId)) return { reply: null };
    const result = msg as ImportSourcesReadResultMessage;
    pendingImportSourcesReads.get(result.request_id)?.({ kind: "result", result });
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
  if (msg.type === "head_texture_result") {
    const result = msg as HeadTextureResultMessage;
    const pending = pendingHeadTextures.get(result.request_id);
    if (pending && connToServerId.get(connId) === pending.serverKeyId) {
      pending.finish({ kind: "result", result });
    }
    return { reply: null };
  }

  if (msg.type === "player_inventory_result") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const result = msg as PlayerInventoryResultMessage;
    pendingInventoryFetches.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }

  if (msg.type === "project_read_result") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const result = msg as ProjectReadResultMessage;
    pendingProjectReads.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }

  if (msg.type === "asset_read_result") {
    if (!connToServerId.get(connId)) return { reply: null };
    const result = msg as AssetReadResultMessage;
    pendingAssetReads.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }

  if (msg.type === "asset_write_result") {
    if (!connToServerId.get(connId)) return { reply: null };
    const result = msg as AssetWriteResultMessage;
    pendingAssetWrites.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }

  if (msg.type === "project_draft_result") {
    const result = msg as unknown as DraftResult & { type: string; request_id: string };
    const pending = pendingDrafts.get(result.request_id);
    if (pending?.connId === connId && connToServerId.has(connId)) {
      const { type: _type, request_id: _requestId, ...payload } = result;
      pending.finish({ kind: "result", result: payload });
    }
    return { reply: null };
  }

  if (msg.type === "project_copy_result") {
    const result = msg as ProjectCopyResultMessage;
    const pending = pendingCopies.get(result.request_id);
    if (pending && pending.connId === connId && connToServerId.has(connId) && pending.request.operation_id === result.operation_id && pending.request.target_id === result.target_id && pending.request.fingerprint === result.fingerprint) pending.finish({ kind: "result", result });
    return { reply: null };
  }

  if (msg.type === "project_rename_result") {
    const serverId = connToServerId.get(connId);
    const result = msg as ProjectRenameResultMessage;
    const pending = pendingRenames.get(result.request_id);
    if (!pending || pending.serverKeyId !== serverId || pending.message.operation_id !== result.operation_id || pending.message.project_id !== result.project_id || pending.message.target_project_id !== result.target_project_id) return { reply: null };
    if (result.ok) {
      const operation = await completeProjectRename(serverId, result);
      announceProjectRename(serverId, operation.projectId, operation.sourceId, operation.targetId);
    } else if (isTerminalRenameError(result.error)) {
      await failProjectRename(result.operation_id);
    }
    pending.resolve({ kind: "result", result });
    return { reply: null };
  }

  if (msg.type === "project_list_result") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const result = msg as ProjectListResultMessage;
    await reconcileServerProjectIdentity(serverId, result);
    const pending = await pendingProjectRenames(serverId);
    const reserved = new Set(pending.flatMap((op) => [op.sourceId.toLowerCase(), op.targetId.toLowerCase()]));
    const copyReservations = await db.select({ targetId: projectCopies.targetId }).from(projectCopies).where(and(eq(projectCopies.serverKeyId, serverId), eq(projectCopies.status, "pending")));
    for (const op of copyReservations) reserved.add(op.targetId.toLowerCase());
    pendingProjectLists.get(result.request_id)?.({ kind: "result", result: {
      ...result,
      project_ids: result.project_ids?.filter((id) => !reserved.has(id.toLowerCase())),
      project_roots: result.project_roots?.filter((root) => !reserved.has(root.project_id.toLowerCase())),
      pending_renames: pending.map((op) => ({ operation_id: op.id, project_id: op.sourceId, target_project_id: op.targetId })),
    } });
    return { reply: null };
  }

  if (msg.type === "project_history_result") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const result = msg as ProjectHistoryResultMessage;
    pendingProjectHistories.get(result.request_id)?.({ kind: "result", result });
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
