import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { packBundles, serverKeys } from "../db/schema";
import type { BundleAvailableMessage, HelloAckMessage, HelloMessage } from "../protocol";
import { computeAllPacksHash } from "../lib/hashUtils";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

/** session_id → server DB row id */
const activeSessions = new Map<string, string>();
export const sessionSenders = new Map<string, (msg: string) => void>();

async function validateServerKey(rawKey: string): Promise<string | null> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Processes a raw JSON string received from a plugin WebSocket.
 * Returns a JSON string to send back, or null if no response should be sent.
 * Optional `send` callback is stored for pushing future messages to this session.
 */
export async function handlePluginMessage(
  raw: string,
  send?: (msg: string) => void,
): Promise<string | null> {
  let msg: { type: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }

  if (msg.type === "hello") {
    const hello = msg as HelloMessage;
    const keyId = await validateServerKey(hello.server_key);
    if (!keyId) return null;

    const sessionId = crypto.randomUUID();
    activeSessions.set(sessionId, keyId);
    if (send) sessionSenders.set(sessionId, send);

    const latestHash = await computeAllPacksHash(keyId);
    const needsSync = latestHash !== "" && latestHash !== hello.current_bundle_hash;

    const packs = await db
      .select({ packId: packBundles.packId, hash: packBundles.hash })
      .from(packBundles)
      .where(eq(packBundles.serverId, keyId));

    const ack: HelloAckMessage = {
      type: "hello_ack",
      session_id: sessionId,
      server_id: keyId,
      tier: "free",
      needs_sync: needsSync,
      latest_bundle_hash: latestHash,
      api_url: API_BASE_URL,
    };
    const ackJson = JSON.stringify(ack);

    if (needsSync && send) {
      setTimeout(() => {
        for (const pack of packs) {
          const available: BundleAvailableMessage = {
            type: "bundle_available",
            pack_id: pack.packId,
            url: `${API_BASE_URL}/api/bundles/${pack.packId}`,
            hash: pack.hash,
            signature: "",
          };
          send(JSON.stringify(available));
        }
      }, 0);
    }

    return ackJson;
  }

  if (msg.type === "pong") return null;

  return null;
}
