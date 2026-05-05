import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { linkCodes, packBundles, serverKeys } from "../db/schema";
import { generateCode, generateServerKey } from "../lib/auth";
import { computeAllPacksHash } from "../lib/hashUtils";
import type {
  BundleAvailableMessage,
  HelloAckMessage,
  HelloMessage,
  LinkConfirmedMessage,
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

export function registerConn(connId: string, send: (msg: string) => void): void {
  connSenders.set(connId, send);
}

export function cleanupConn(connId: string): void {
  connSenders.delete(connId);
  for (const [code, cId] of codeToConn) {
    if (cId === connId) codeToConn.delete(code);
  }
}

export function cleanupSession(sessionId: string): void {
  activeSessions.delete(sessionId);
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

    const latestHash = await computeAllPacksHash(keyId);
    const needsSync = latestHash !== "" && latestHash !== hello.current_bundle_hash;

    const packs = await db
      .select({ packId: packBundles.packId, hash: packBundles.hash })
      .from(packBundles)
      .where(eq(packBundles.serverId, keyId));

    const packHashesMap: Record<string, string> = {};
    for (const p of packs) packHashesMap[p.packId] = p.hash;

    const ack: HelloAckMessage = {
      type: "hello_ack",
      session_id: sessionId,
      server_id: keyId,
      tier: "free",
      needs_sync: needsSync,
      latest_bundle_hash: latestHash,
      api_url: API_BASE_URL,
      pack_hashes: packHashesMap,
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
    let valid = false;
    try {
      await db.transaction(async (tx) => {
        const rows = await tx.select().from(linkCodes).where(eq(linkCodes.code, code));
        if (rows.length === 0 || rows[0].claimedAt || rows[0].expiresAt < new Date()) {
          throw new Error("invalid");
        }
        await tx.insert(serverKeys).values({ id, hash, label: null, createdAt: new Date() });
        await tx.update(linkCodes)
          .set({ claimedAt: new Date(), serverKeyId: id })
          .where(eq(linkCodes.code, code));
        valid = true;
      });
    } catch {
      if (!valid) return { reply: null };
    }

    const send = connSenders.get(connId);
    if (send) send(JSON.stringify({ type: "link_confirmed", server_key: key } satisfies LinkConfirmedMessage));
    return { reply: null };
  }

  if (msg.type === "pong") return { reply: null };

  return { reply: null };
}
