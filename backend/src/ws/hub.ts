import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { ensureAssets, assetsDone } from "../lib/mcAssets";
import { editorSessions, linkCodes, packBundles, packConflicts, serverKeys } from "../db/schema";
import { findSessionByTrustCode, generateCode, generateEditorToken, generateServerKey, generateTrustCode } from "../lib/auth";
import { computeAllPacksHash } from "../lib/hashUtils";
import { customItemsCacheDir, readCustomItemsHash, processBundle } from "../lib/customItems";
import { currentPackInfo } from "../lib/resourcePack";
import type {
  BundleAvailableMessage,
  CustomItemsBundleMessage,
  CustomItemsChangedMessage,
  CustomItemsRequestMessage,
  EditorDraftUpdateMessage,
  EditorSessionReadyMessage,
  HelloAckMessage,
  HelloMessage,
  LinkConfirmedMessage,
  ResourcePackUpdatedMessage,
  SessionExpiredMessage,
  SessionTrustedMessage,
  SetupClaimMessage,
  SetupCodeMessage,
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
// link_code → connId (for B1: push link_confirmed to the plugin that generated the code)
const codeToConn = new Map<string, string>();
// Editor WS connections: sessionId → sendFn
export const editorSenders = new Map<string, (msg: string) => void>();
// sessionId → serverKeyId (for grouping editors by server)
export const editorTokenToServer = new Map<string, string>();
// connId → serverKeyId (set after successful hello)
export const connToServerId = new Map<string, string>();
// sessionId → editor IP address (set when editor WS connects)
const editorTokenToIp = new Map<string, string>();
// serverKeyId → minecraft version (set on hello, used by /api/items)
const serverIdToMcVersion = new Map<string, string>();

export function registerConn(connId: string, send: (msg: string) => void): void {
  connSenders.set(connId, send);
}

export function cleanupConn(connId: string): void {
  connSenders.delete(connId);
  connToServerId.delete(connId);
  for (const [code, cId] of codeToConn) {
    if (cId === connId) codeToConn.delete(code);
  }
}

export function cleanupSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

export function registerEditorConn(sessionId: string, serverKeyId: string, send: (msg: string) => void): void {
  editorSenders.set(sessionId, send);
  editorTokenToServer.set(sessionId, serverKeyId);
}

export function cleanupEditorConn(sessionId: string): void {
  editorSenders.delete(sessionId);
  editorTokenToServer.delete(sessionId);
  editorTokenToIp.delete(sessionId);
}

// Called by link.ts POST /:code/claim (B1 flow: browser claims plugin's code).
// No-op if no plugin session is waiting on this code (B2 flow, or plugin disconnected).
export function pushLinkConfirmed(code: string, serverKey: string): void {
  const connId = codeToConn.get(code);
  if (!connId) return;
  const send = connSenders.get(connId);
  if (send) send(JSON.stringify({ type: "link_confirmed", server_key: serverKey } satisfies LinkConfirmedMessage));
  codeToConn.delete(code);
}

async function validateServerKey(rawKey: string): Promise<string | null> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  return rows.length > 0 ? rows[0].id : null;
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
): Promise<{ reply: string | null; sessionId?: string; push?: string[] }> {
  let msg: { type: string };
  try { msg = JSON.parse(raw); } catch { return { reply: null }; }

  // ── authenticated hello ──────────────────────────────────────────────────
  if (msg.type === "hello") {
    if (typeof (msg as Record<string, unknown>).server_key !== "string") return { reply: null };
    const hello = msg as HelloMessage;
    const keyId = await validateServerKey(hello.server_key);
    if (!keyId) return { reply: null };

    const sessionId = crypto.randomUUID();
    activeSessions.set(sessionId, keyId);
    connToServerId.set(connId, keyId);
    serverIdToMcVersion.set(keyId, hello.minecraft_version);
    db.update(serverKeys).set({ lastMcVersion: hello.minecraft_version }).where(eq(serverKeys.id, keyId)).catch(() => {});
    handleCustomItemsHash(keyId, (hello as HelloMessage & { custom_items_hash?: string }).custom_items_hash).catch(() => {});
    if (!assetsDone(hello.minecraft_version)) {
      ensureAssets(hello.minecraft_version).catch((err) =>
        console.error("[mc-assets] Background download failed:", err),
      );
    }

    const latestHash = await computeAllPacksHash(keyId);
    const needsSync = latestHash !== "" && latestHash !== hello.current_bundle_hash;

    const allPacks = await db
      .select({ packId: packBundles.packId, hash: packBundles.hash, deletedAt: packBundles.deletedAt })
      .from(packBundles)
      .where(eq(packBundles.serverId, keyId));

    const packs = allPacks.filter((p) => p.deletedAt == null);
    const deletedPackIds = allPacks.filter((p) => p.deletedAt != null).map((p) => p.packId);

    const packHashesMap: Record<string, string> = {};
    for (const p of packs) packHashesMap[p.packId] = p.hash;

    // Create minimal editor stubs for packs the plugin has on disk but the backend doesn't know about
    const knownPackIds = new Set(packs.map((p) => p.packId));
    const localPackIds = hello.local_pack_ids ?? [];
    const missingPackIds = localPackIds.filter((id) => !knownPackIds.has(id));
    if (missingPackIds.length > 0) {
      const now = new Date().toISOString();
      await db.insert(packBundles).values(
        missingPackIds.map((packId) => ({
          id: crypto.randomUUID(),
          serverId: keyId,
          packId,
          hash: "",
          filesJson: "{}",
          editorJson: JSON.stringify({
            id: packId,
            name: packId,
            source: "user_created",
            createdAt: now,
            updatedAt: now,
            menus: [],
            commands: [],
            templates: [],
            assets: [],
            dataSources: [],
            dialogs: [],
            importedConnectors: [],
            i18nKeys: {},
            defaultLang: "en",
            canvasLayout: {},
          }),
          createdAt: new Date(),
        })),
      ).onConflictDoNothing();
    }

    const rp = await currentPackInfo(keyId);

    const ack: HelloAckMessage = {
      type: "hello_ack",
      session_id: sessionId,
      server_id: keyId,
      tier: "free",
      needs_sync: needsSync,
      latest_bundle_hash: latestHash,
      api_url: API_BASE_URL,
      bundle_url: BUNDLE_BASE_URL,
      pack_hashes: packHashesMap,
      deleted_pack_ids: deletedPackIds,
      resource_pack: rp,
    };

    const push: string[] = [];
    if (needsSync) {
      for (const pack of packs) {
        const available: BundleAvailableMessage = {
          type: "bundle_available",
          pack_id: pack.packId,
          url: `${BUNDLE_BASE_URL}/api/bundles/${pack.packId}`,
          hash: pack.hash,
          signature: "",
        };
        push.push(JSON.stringify(available));
      }
    }

    return { reply: JSON.stringify(ack), sessionId, push };
  }

  // ── setup_request (B1): plugin asks for a link code ──────────────────────
  if (msg.type === "setup_request") {
    const code = generateCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    await db.insert(linkCodes).values({ code, createdAt: now, expiresAt });
    codeToConn.set(code, connId);
    setTimeout(() => codeToConn.delete(code), 10 * 60 * 1000);

    const reply: SetupCodeMessage = {
      type: "setup_code",
      code,
      url: `${EDITOR_URL}/link?code=${code}`,
      expires_at: expiresAt.toISOString(),
    };
    return { reply: JSON.stringify(reply) };
  }

  // ── setup_claim (B2): plugin claims a dashboard-generated code ───────────
  if (msg.type === "setup_claim") {
    const raw = msg as Record<string, unknown>;
    if (typeof raw.code !== "string" || raw.code.length === 0) return { reply: null };
    const { code } = raw as SetupClaimMessage;

    const { id, key, hash } = await generateServerKey();
    const claimed = await db.transaction(async (tx) => {
      const rows = await tx.select().from(linkCodes).where(eq(linkCodes.code, code));
      if (rows.length === 0 || rows[0].claimedAt || rows[0].expiresAt < new Date()) return false;
      await tx.insert(serverKeys).values({ id, hash, label: null, createdAt: new Date() });
      await tx.update(linkCodes)
        .set({ claimedAt: new Date(), serverKeyId: id })
        .where(eq(linkCodes.code, code));
      return true;
    });
    if (!claimed) return { reply: null };

    const send = connSenders.get(connId);
    if (send) send(JSON.stringify({ type: "link_confirmed", server_key: key } satisfies LinkConfirmedMessage));
    return { reply: null };
  }

  // ── editor_session_request: generate a browser session token ─────────────
  if (msg.type === "editor_session_request") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const raw = msg as Record<string, unknown>;
    const sender = typeof raw.sender === "string" ? raw.sender : "CONSOLE";
    const token = generateEditorToken();
    const trustCode = generateTrustCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);  // 7 days
    await db.insert(editorSessions).values({
      token, serverKeyId: serverId, createdBy: sender, createdAt: now, expiresAt, trustCode,
    });
    const reply: EditorSessionReadyMessage = {
      type: "editor_session_ready",
      url: `${EDITOR_URL}/session?token=${token}`,
      expires_at: expiresAt.toISOString(),
      trust_code: trustCode,
    };
    return { reply: JSON.stringify(reply) };
  }

  // ── editor_session_revoke: revoke all sessions for this server ────────────
  if (msg.type === "editor_session_revoke") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    await db
      .update(editorSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(editorSessions.serverKeyId, serverId), isNull(editorSessions.revokedAt)));
    for (const [sessionId, sId] of editorTokenToServer) {
      if (sId !== serverId) continue;
      const send = editorSenders.get(sessionId);
      if (send) send(JSON.stringify({ type: "session_expired" } satisfies SessionExpiredMessage));
    }
    return { reply: null };
  }

  // ── editor_trust_request: plugin confirms editor IP trust ────────────────
  if (msg.type === "editor_trust_request") {
    const raw = msg as Record<string, unknown>;
    if (typeof raw.trust_code !== "string") return { reply: null };
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };

    const session = await findSessionByTrustCode(raw.trust_code as string);
    if (!session || session.serverKeyId !== serverId) return { reply: null };

    // Use urlToken (stable session PK) instead of session.accessToken (rotates every 4 min)
    const ip = editorTokenToIp.get(session.urlToken) ?? "unknown";

    await db.update(editorSessions)
      .set({ trustedAt: new Date(), trustedIp: ip })
      .where(eq(editorSessions.token, session.urlToken));

    const send = editorSenders.get(session.urlToken);
    if (send) send(JSON.stringify({ type: "session_trusted" } satisfies SessionTrustedMessage));

    return { reply: null };
  }

  if (msg.type === "pong") return { reply: null };

  // ── pack_divergence_detected: plugin signals disk/backend mismatch ─────────
  if (msg.type === "pack_divergence_detected") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const raw = msg as Record<string, unknown>;
    const packId = raw.pack_id as string | undefined;
    const diskFiles = raw.disk_files as Record<string, string> | undefined;
    const diskHash = raw.disk_hash as string | undefined;
    const lastSyncedHash = raw.last_synced_hash as string | undefined;
    if (!packId || !diskFiles || diskHash == null || lastSyncedHash == null) return { reply: null };

    const existing = await db.select().from(packBundles)
      .where(and(eq(packBundles.serverId, serverId), eq(packBundles.packId, packId)));
    if (existing.length === 0 || existing[0].deletedAt != null) return { reply: null };
    const backendHashAtDetection = existing[0].hash;

    const now = new Date();
    const conflictId = crypto.randomUUID();

    const open = await db.select().from(packConflicts).where(and(
      eq(packConflicts.serverId, serverId),
      eq(packConflicts.packId, packId),
      isNull(packConflicts.resolvedAt),
    ));

    let finalConflictId: string;
    if (open.length > 0) {
      await db.update(packConflicts)
        .set({
          diskFilesJson: JSON.stringify(diskFiles),
          diskHash,
          lastSyncedHash,
          backendHashAtDetection,
        })
        .where(eq(packConflicts.id, open[0].id));
      finalConflictId = open[0].id;
    } else {
      await db.insert(packConflicts).values({
        id: conflictId,
        serverId,
        packId,
        diskFilesJson: JSON.stringify(diskFiles),
        diskHash,
        lastSyncedHash,
        backendHashAtDetection,
        detectedAt: now,
      });
      finalConflictId = conflictId;
    }

    const payload = JSON.stringify({
      type: "pack_conflict_detected",
      conflict_id: finalConflictId,
      pack_id: packId,
      detected_at: now.toISOString(),
    });
    for (const [sessionId, sId] of editorTokenToServer) {
      if (sId !== serverId) continue;
      const send = editorSenders.get(sessionId);
      if (send) send(payload);
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

  return { reply: null };
}

export async function pushBundleAvailable(
  serverKeyId: string,
  packId: string,
  hash: string,
): Promise<void> {
  // Freeze: skip broadcast if an open conflict exists for this (server, pack)
  const open = await db.select({ id: packConflicts.id }).from(packConflicts).where(and(
    eq(packConflicts.serverId, serverKeyId),
    eq(packConflicts.packId, packId),
    isNull(packConflicts.resolvedAt),
  ));
  if (open.length > 0) return;

  const url = `${BUNDLE_BASE_URL}/api/bundles/${packId}`;
  const payload = JSON.stringify({
    type: "bundle_available",
    pack_id: packId,
    url,
    hash,
    signature: "",
  } satisfies BundleAvailableMessage);

  for (const [connId, sId] of connToServerId) {
    if (sId !== serverKeyId) continue;
    const send = connSenders.get(connId);
    if (send) send(payload);
  }
}

export function broadcastDraftUpdate(
  serverKeyId: string,
  packId: string,
  menuId: string,
  menuYaml: string,
  senderSessionId: string,
): void {
  const payload = JSON.stringify({
    type: "draft_update",
    pack_id: packId,
    menu_id: menuId,
    menu_yaml: menuYaml,
    updated_by: senderSessionId,
  } satisfies EditorDraftUpdateMessage);

  for (const [sessionId, send] of editorSenders) {
    if (sessionId === senderSessionId) continue;
    if (editorTokenToServer.get(sessionId) !== serverKeyId) continue;
    send(payload);
  }

  for (const [connId, sId] of connToServerId) {
    if (sId !== serverKeyId) continue;
    const send = connSenders.get(connId);
    if (send) send(JSON.stringify({
      type: "draft_update",
      pack_id: packId,
      menu_id: menuId,
      menu_yaml: menuYaml,
    }));
  }
}

export function trackEditorIp(sessionId: string, ip: string): void {
  editorTokenToIp.set(sessionId, ip);
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

export function pushPackDeleted(serverKeyId: string, packId: string): void {
  const payload = JSON.stringify({ type: "pack_deleted", pack_id: packId });
  // Push to plugin connections
  for (const [connId, sId] of connToServerId) {
    if (sId !== serverKeyId) continue;
    const send = connSenders.get(connId);
    if (send) send(payload);
  }
  // Push to editor connections (so other open tabs close the pack view)
  for (const [sessionId, sId] of editorTokenToServer) {
    if (sId !== serverKeyId) continue;
    const send = editorSenders.get(sessionId);
    if (send) send(payload);
  }
}
