import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { ensureAssets, assetsDone } from "../lib/mcAssets";
import { editorSessions, linkCodes, packBindings, packBranches, packCommits, packs, serverKeyHelloes, serverKeys } from "../db/schema";
import { createNetwork } from "../lib/networkManager";
import { createPack, getPack, upsertPackContent } from "../lib/packStorage";
import { createBinding, listPacksForServerKey, listServerKeysForPack } from "../lib/packBindingManager";
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

async function validateServerKey(rawKey: string): Promise<{ id: string; allowedIps: string[] | null } | null> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  if (rows.length === 0) return null;
  return { id: rows[0].id, allowedIps: rows[0].allowedIps ?? null };
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
    handleCustomItemsHash(keyId, (hello as HelloMessage & { custom_items_hash?: string }).custom_items_hash).catch(() => {});
    if (!assetsDone(hello.minecraft_version)) {
      ensureAssets(hello.minecraft_version).catch((err) =>
        console.error("[mc-assets] Background download failed:", err),
      );
    }

    const latestHash = await computeAllPacksHash(keyId);
    const needsSync = latestHash !== "" && latestHash !== hello.current_bundle_hash;

    const boundPacks = await listPacksForServerKey(keyId);   // already excludes deletedAt
    const deletedRows = await db
      .select({ id: packs.id })
      .from(packs)
      .innerJoin(packBindings, eq(packBindings.packId, packs.id))
      .where(and(eq(packBindings.serverKeyId, keyId), isNotNull(packs.deletedAt)));
    const deletedPackIds = deletedRows.map((r) => r.id);

    // Build pack_hashes via branch → commit content hash (Phase 2).
    const bindings = await db
      .select({ packId: packBindings.packId, branchName: packBindings.branchName })
      .from(packBindings)
      .where(eq(packBindings.serverKeyId, keyId));

    const packHashesMap: Record<string, string> = {};
    for (const b of bindings) {
      const branch = await db.select().from(packBranches).where(and(
        eq(packBranches.packId, b.packId), eq(packBranches.name, b.branchName),
      ));
      if (branch.length === 0) continue;
      const cmt = await db.select({ contentHash: packCommits.contentHash })
        .from(packCommits)
        .where(eq(packCommits.id, branch[0].headCommitId));
      if (cmt.length === 0) continue;
      packHashesMap[b.packId] = cmt[0].contentHash;
    }

    // Create minimal stubs for packs the plugin has on disk but the backend doesn't know about.
    const knownPackIds = new Set(boundPacks.map((p) => p.id));
    const localPackIds = hello.local_pack_ids ?? [];
    const missingPackIds = localPackIds.filter((id) => !knownPackIds.has(id));
    if (missingPackIds.length > 0) {
      const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, keyId));
      const sk = skRows[0];
      if (sk) {
        for (const pid of missingPackIds) {
          await createPack({ networkId: sk.networkId, name: pid, id: pid });
          await createBinding(keyId, pid);
        }
      }
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
      for (const b of bindings) {
        const hash = packHashesMap[b.packId];
        if (!hash) continue;
        const available: BundleAvailableMessage = {
          type: "bundle_available",
          pack_id: b.packId,
          url: `${BUNDLE_BASE_URL}/api/v1/bundles/${b.packId}?branch=${encodeURIComponent(b.branchName)}`,
          hash,
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
    const networkForSetup = await createNetwork(`Network ${id.slice(0, 6)}`);
    const claimed = await db.transaction(async (tx) => {
      const rows = await tx.select().from(linkCodes).where(eq(linkCodes.code, code));
      if (rows.length === 0 || rows[0].claimedAt || rows[0].expiresAt < new Date()) return false;
      await tx.insert(serverKeys).values({ id, hash, label: null, networkId: networkForSetup.id, createdAt: new Date() });
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

  // ── pack_divergence_detected: no-op (Plan 1C: backend-as-truth) ──────────
  if (msg.type === "pack_divergence_detected") {
    return { reply: null };
  }

  // ── local_push: plugin pushes local pack files to backend (/artisan pushLocal) ─
  if (msg.type === "local_push") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const raw = msg as Record<string, unknown>;
    const packId = raw.pack_id as string | undefined;
    const files = raw.files as Record<string, string> | undefined;
    const hash = raw.hash as string | undefined;
    if (!packId || !files || !hash) return { reply: null };

    const sk = (await db.select().from(serverKeys).where(eq(serverKeys.id, serverId)))[0];
    if (!sk) return { reply: null };

    let pack = await getPack(packId);
    if (!pack) {
      pack = await createPack({ networkId: sk.networkId, name: packId, id: packId });
    }
    const bound = await listPacksForServerKey(serverId);
    if (!bound.find((p) => p.id === packId)) {
      await createBinding(serverId, packId);
    }
    await upsertPackContent(packId, { hash, filesJson: JSON.stringify(files) });
    await pushBundleAvailable(packId, "main", hash);
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

  // ── unknown message type: log and ignore ──────────────────────────────────
  console.debug(
    `[hub] unknown message type '${(msg as any).type}' from conn ${connId} ` +
    `(protocol_version=${(msg as any).protocol_version ?? "?"}). Ignoring.`,
  );
  return { reply: null };
}

export async function pushBundleAvailable(
  packId: string,
  branchName: string,
  contentHash: string,
): Promise<void> {
  // Find all server_keys bound to (packId, branchName).
  const targets = await db
    .select({ serverKeyId: packBindings.serverKeyId })
    .from(packBindings)
    .where(and(eq(packBindings.packId, packId), eq(packBindings.branchName, branchName)));
  if (targets.length === 0) return;

  const url = `${BUNDLE_BASE_URL}/api/v1/bundles/${packId}?branch=${encodeURIComponent(branchName)}`;
  const payload = JSON.stringify({
    type: "bundle_available",
    pack_id: packId,
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

export function pushModuleEvent(
  serverKeyId: string,
  event: { kind: "config_reload"; module_id: string } | { kind: "data_reload"; data_source_ref: string },
): void {
  const payload = JSON.stringify({ type: "module_event", payload: event });
  for (const [sessionId, send] of editorSenders) {
    if (editorTokenToServer.get(sessionId) !== serverKeyId) continue;
    send(payload);
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

export async function pushPackDeleted(packId: string): Promise<void> {
  const targets = await listServerKeysForPack(packId);
  if (targets.length === 0) return;
  const payload = JSON.stringify({ type: "pack_deleted", pack_id: packId });
  const targetSet = new Set(targets);
  // Push to plugin connections for each server_key bound to this pack.
  for (const [connId, sId] of connToServerId) {
    if (!targetSet.has(sId)) continue;
    const send = connSenders.get(connId);
    if (send) send(payload);
  }
  // Push to editor connections (so other open tabs close the pack view).
  for (const [sessionId, sId] of editorTokenToServer) {
    if (!targetSet.has(sId)) continue;
    const send = editorSenders.get(sessionId);
    if (send) send(payload);
  }
}
