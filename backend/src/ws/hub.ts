import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";
import type { HelloAckMessage, HelloMessage } from "../protocol";

/** session_id → server DB row id */
const activeSessions = new Map<string, string>();

async function validateServerKey(rawKey: string): Promise<string | null> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Processes a raw JSON string received from a plugin WebSocket.
 * Returns a JSON string to send back, or null if no response should be sent.
 */
export async function handlePluginMessage(raw: string): Promise<string | null> {
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

    const ack: HelloAckMessage = {
      type: "hello_ack",
      session_id: sessionId,
      server_id: keyId,
      tier: "free",
      needs_sync: false,
      latest_bundle_hash: "",
    };
    return JSON.stringify(ack);
  }

  if (msg.type === "pong") return null;

  return null;
}
