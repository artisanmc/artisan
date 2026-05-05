import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { packBundles, serverKeys } from "../db/schema";
import type { BundleAvailableMessage, HelloAckMessage, HelloMessage } from "../protocol";
import { computeAllPacksHash } from "../lib/hashUtils";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

const activeSessions = new Map<string, string>();
export const sessionSenders = new Map<string, (msg: string) => void>();

async function validateServerKey(rawKey: string): Promise<string | null> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  return rows.length > 0 ? rows[0].id : null;
}

export async function handlePluginMessage(
  raw: string,
): Promise<{ reply: string | null; sessionId?: string; push?: string[] }> {
  let msg: { type: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return { reply: null };
  }

  if (msg.type === "hello") {
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
          url: `${API_BASE_URL}/api/bundles/${pack.packId}`,
          hash: pack.hash,
          signature: "", // TODO: implement bundle signing
        };
        push.push(JSON.stringify(available));
      }
    }

    return { reply: JSON.stringify(ack), sessionId, push };
  }

  if (msg.type === "pong") return { reply: null };

  return { reply: null };
}

export function cleanupSession(sessionId: string): void {
  activeSessions.delete(sessionId);
  sessionSenders.delete(sessionId);
}
