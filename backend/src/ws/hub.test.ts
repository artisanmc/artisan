import { describe, expect, test } from "bun:test";
import { app } from "../app";
import { handlePluginMessage, registerConn, registerEditorConn, cleanupEditorConn, broadcastDraftUpdate, getMcVersion, trackEditorIp, pushResourcePackUpdated, connToServerId, connSenders } from "./hub";
import type { HelloMessage, HelloAckMessage } from "../protocol";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";
import { generateEditorToken, generateServerKey, generateTrustCode } from "../lib/auth";
import { rebuildResourcePack } from "../lib/resourcePack";
import { eq } from "drizzle-orm";

describe("handlePluginMessage", () => {
  test("hello with unknown key returns null", async () => {
    const hello: HelloMessage = {
      type: "hello",
      server_key: "sk_doesnotexist",
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage("test-conn", JSON.stringify(hello));
    expect(result.reply).toBeNull();
  });

  test("hello with valid key returns hello_ack", async () => {
    // First create a key via the API
    const createRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "hub-test" }),
    });
    const { key } = (await createRes.json()) as { key: string };

    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage("test-conn", JSON.stringify(hello));
    expect(result.reply).not.toBeNull();
    const ack = JSON.parse(result.reply!) as HelloAckMessage;
    expect(ack.type).toBe("hello_ack");
    expect(ack.session_id).toBeDefined();
    expect(ack.tier).toBe("free");
    expect(ack.api_url).toBeDefined();
  });
});

describe("setup_request", () => {
  test("returns setup_code with 8-char code and url", async () => {
    const connId = "conn-setup-req";
    registerConn(connId, () => {});
    const result = await handlePluginMessage(connId, JSON.stringify({ type: "setup_request" }));
    expect(result.reply).not.toBeNull();
    const msg = JSON.parse(result.reply!) as { type: string; code: string; url: string; expires_at: string };
    expect(msg.type).toBe("setup_code");
    expect(msg.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(msg.url).toContain(msg.code);
    expect(new Date(msg.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("setup_claim", () => {
  test("valid code returns link_confirmed and pushes it to the registered conn", async () => {
    // Create a code via REST
    const createRes = await app.request("/api/link", { method: "POST" });
    const { code } = (await createRes.json()) as { code: string };

    const received: string[] = [];
    const connId = "conn-setup-claim";
    registerConn(connId, (msg) => received.push(msg));

    await handlePluginMessage(connId, JSON.stringify({ type: "setup_claim", code }));
    expect(received.length).toBe(1);
    const msg = JSON.parse(received[0]) as { type: string; server_key: string };
    expect(msg.type).toBe("link_confirmed");
    expect(msg.server_key).toMatch(/^sk_[0-9a-f]{64}$/);
  });

  test("expired or unknown code returns null reply", async () => {
    const connId = "conn-setup-claim-bad";
    registerConn(connId, () => {});
    const result = await handlePluginMessage(connId, JSON.stringify({ type: "setup_claim", code: "BADCODE1" }));
    expect(result.reply).toBeNull();
  });
});

describe("editor_session_request", () => {
  test("returns editor_session_ready with url when authenticated", async () => {
    const connId = "conn-editor-req";
    registerConn(connId, () => {});

    const { id: keyId, key, hash } = await generateServerKey();
    await db.insert(serverKeys).values({ id: keyId, hash, createdAt: new Date() });

    const hello = { type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "" };
    await handlePluginMessage(connId, JSON.stringify(hello));

    const result = await handlePluginMessage(connId, JSON.stringify({ type: "editor_session_request", sender: "AdminPlayer" }));
    expect(result.reply).not.toBeNull();
    const msg = JSON.parse(result.reply!) as { type: string; url: string; expires_at: string };
    expect(msg.type).toBe("editor_session_ready");
    expect(msg.url).toContain("/session?token=");
    const body = msg as { type: string; url: string; expires_at: string; trust_code: string };
    expect(typeof body.trust_code).toBe("string");
    expect(body.trust_code.length).toBe(6);
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000); // > 6 days
  });

  test("returns null when connection not authenticated", async () => {
    const connId = "conn-editor-unauth";
    registerConn(connId, () => {});
    const result = await handlePluginMessage(connId, JSON.stringify({ type: "editor_session_request", sender: "AdminPlayer" }));
    expect(result.reply).toBeNull();
  });
});

describe("editor_session_revoke", () => {
  test("revokes all active sessions and pushes session_expired to editors", async () => {
    const connId = "conn-editor-revoke";
    registerConn(connId, () => {});

    const { id: keyId, key, hash } = await generateServerKey();
    await db.insert(serverKeys).values({ id: keyId, hash, createdAt: new Date() });
    await handlePluginMessage(connId, JSON.stringify({ type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "" }));

    const token = generateEditorToken();
    await db.insert(editorSessions).values({ token, serverKeyId: keyId, createdBy: "CONSOLE", createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
    const editorReceived: string[] = [];
    // Maps are now keyed by sessionId (urlToken = stable session PK)
    registerEditorConn(token, keyId, (msg) => editorReceived.push(msg));

    await handlePluginMessage(connId, JSON.stringify({ type: "editor_session_revoke" }));

    expect(editorReceived.length).toBe(1);
    expect(JSON.parse(editorReceived[0])).toMatchObject({ type: "session_expired" });
  });
});

describe("editor_trust_request", () => {
  test("sets trusted_at + trusted_ip, pushes session_trusted to editor WS", async () => {
    const connId = "conn-trust-test";
    registerConn(connId, () => {});

    const { id: keyId, key, hash } = await generateServerKey();
    await db.insert(serverKeys).values({ id: keyId, hash, createdAt: new Date() });
    await handlePluginMessage(connId, JSON.stringify({
      type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "",
    }));

    const urlToken = "url_trust_" + crypto.randomUUID().slice(0, 8);
    const accessToken = generateEditorToken();
    const trustCode = generateTrustCode();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "CONSOLE",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      exchangedAt: new Date(), accessToken, accessExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      trustCode,
    });

    const editorReceived: string[] = [];
    // Maps are keyed by urlToken (stable session PK), not accessToken (rotates)
    registerEditorConn(urlToken, keyId, (msg) => editorReceived.push(msg));
    trackEditorIp(urlToken, "10.0.0.1");

    await handlePluginMessage(connId, JSON.stringify({ type: "editor_trust_request", trust_code: trustCode }));

    expect(editorReceived.length).toBe(1);
    expect(JSON.parse(editorReceived[0])).toMatchObject({ type: "session_trusted" });

    const rows = await db.select().from(editorSessions).where(eq(editorSessions.token, urlToken));
    expect(rows[0].trustedAt).not.toBeNull();
    expect(rows[0].trustedIp).toBe("10.0.0.1");
  });

  test("ignores trust request with unknown code", async () => {
    const connId = "conn-trust-unknown";
    registerConn(connId, () => {});
    const { id: keyId, key, hash } = await generateServerKey();
    await db.insert(serverKeys).values({ id: keyId, hash, createdAt: new Date() });
    await handlePluginMessage(connId, JSON.stringify({
      type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "",
    }));
    const result = await handlePluginMessage(connId, JSON.stringify({ type: "editor_trust_request", trust_code: "XXXXXX" }));
    expect(result.reply).toBeNull();
  });
});

describe("broadcastDraftUpdate", () => {
  test("pushes draft_update to other editor connections for the same server", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "bdu" + keyId.slice(0, 8), createdAt: new Date() });

    const tokenA = generateEditorToken();
    const tokenB = generateEditorToken();
    await db.insert(editorSessions).values({ token: tokenA, serverKeyId: keyId, createdBy: "A", createdAt: new Date(), expiresAt: new Date(Date.now() + 1800000) });
    await db.insert(editorSessions).values({ token: tokenB, serverKeyId: keyId, createdBy: "B", createdAt: new Date(), expiresAt: new Date(Date.now() + 1800000) });

    const receivedByB: string[] = [];
    registerEditorConn(tokenA, keyId, () => {});
    registerEditorConn(tokenB, keyId, (msg) => receivedByB.push(msg));

    broadcastDraftUpdate(keyId, "pack1", "shop_main", "title: Shop\n", tokenA);

    expect(receivedByB.length).toBe(1);
    const msg = JSON.parse(receivedByB[0]) as { type: string; menu_id: string };
    expect(msg.type).toBe("draft_update");
    expect(msg.menu_id).toBe("shop_main");
  });
});

describe("getMcVersion", () => {
  test("hello stores minecraft_version, getMcVersion returns it", async () => {
    const createRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "mc-version-test" }),
    });
    const { key } = (await createRes.json()) as { key: string };

    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.99",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage("conn-mcver", JSON.stringify(hello));
    expect(result.reply).not.toBeNull();
    const ack = JSON.parse(result.reply!) as HelloAckMessage;
    expect(await getMcVersion(ack.server_id)).toBe("1.21.99");
  });
});

describe("resource_pack in hello_ack", () => {
  test("hello_ack includes resource_pack: null when no pack has been built", async () => {
    const { id: keyId, key, hash } = await generateServerKey();
    await db.insert(serverKeys).values({ id: keyId, hash, createdAt: new Date() });

    const connId = "conn-rp-null";
    registerConn(connId, () => {});
    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage(connId, JSON.stringify(hello));
    expect(result.reply).not.toBeNull();
    const ack = JSON.parse(result.reply!) as HelloAckMessage;
    expect(ack.type).toBe("hello_ack");
    expect(ack.resource_pack).toBeNull();
  });

  test("hello_ack includes { url, hash } after a pack was built", async () => {
    const { id: keyId, key, hash } = await generateServerKey();
    await db.insert(serverKeys).values({ id: keyId, hash, createdAt: new Date() });

    const packInfo = await rebuildResourcePack(keyId);

    const connId = "conn-rp-built";
    registerConn(connId, () => {});
    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage(connId, JSON.stringify(hello));
    expect(result.reply).not.toBeNull();
    const ack = JSON.parse(result.reply!) as HelloAckMessage;
    expect(ack.type).toBe("hello_ack");
    expect(ack.resource_pack).not.toBeNull();
    expect(ack.resource_pack!.hash).toBe(packInfo.hash);
    expect(ack.resource_pack!.url).toContain(packInfo.hash);
  });
});

describe("pushResourcePackUpdated", () => {
  test("broadcasts only to matching serverKey connections", () => {
    const serverKeyA = "test-sk-rpu-a-" + crypto.randomUUID().slice(0, 8);
    const serverKeyB = "test-sk-rpu-b-" + crypto.randomUUID().slice(0, 8);
    const connA = "conn-rpu-a-" + crypto.randomUUID().slice(0, 8);
    const connB = "conn-rpu-b-" + crypto.randomUUID().slice(0, 8);

    const receivedA: string[] = [];
    const receivedB: string[] = [];

    connSenders.set(connA, (msg) => receivedA.push(msg));
    connSenders.set(connB, (msg) => receivedB.push(msg));
    connToServerId.set(connA, serverKeyA);
    connToServerId.set(connB, serverKeyB);

    pushResourcePackUpdated(serverKeyA, "http://example.com/pack.zip", "abc123");

    expect(receivedA.length).toBe(1);
    const msg = JSON.parse(receivedA[0]) as { type: string; url: string; hash: string };
    expect(msg.type).toBe("resource_pack_updated");
    expect(msg.url).toBe("http://example.com/pack.zip");
    expect(msg.hash).toBe("abc123");

    expect(receivedB.length).toBe(0);

    // cleanup
    connSenders.delete(connA);
    connSenders.delete(connB);
    connToServerId.delete(connA);
    connToServerId.delete(connB);
  });
});

describe("pack_divergence_detected", () => {
  test("upserts pack_conflicts row and notifies editors", async () => {
    const { db } = await import("../db/index");
    const { serverKeys, packBundles, packConflicts, editorSessions } = await import("../db/schema");
    const { and, eq } = await import("drizzle-orm");

    const keyId = crypto.randomUUID();
    const rawKey = "srv-key-divergence";
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
    await db.insert(serverKeys).values({ id: keyId, hash: keyHash, label: "test", createdAt: new Date() });
    await db.insert(packBundles).values({
      id: crypto.randomUUID(), serverId: keyId, packId: "p_div",
      hash: "backend_hash_x", filesJson: "{}", editorJson: "{}", createdAt: new Date(),
    });

    const { handlePluginMessage, connToServerId } = await import("./hub");
    const connId = crypto.randomUUID();
    connToServerId.set(connId, keyId);

    const msg = JSON.stringify({
      type: "pack_divergence_detected",
      pack_id: "p_div",
      disk_files: { "menus/m.yaml": "id: m\n" },
      disk_hash: "disk_hash_y",
      last_synced_hash: "prev_hash_z",
    });
    await handlePluginMessage(connId, msg);

    const rows = await db.select().from(packConflicts).where(and(
      eq(packConflicts.serverId, keyId),
      eq(packConflicts.packId, "p_div"),
    ));
    expect(rows.length).toBe(1);
    expect(rows[0].diskHash).toBe("disk_hash_y");
    expect(rows[0].lastSyncedHash).toBe("prev_hash_z");
    expect(rows[0].resolvedAt).toBeNull();
  });

  test("re-detection updates existing open conflict (no second row)", async () => {
    const { db } = await import("../db/index");
    const { serverKeys, packBundles, packConflicts } = await import("../db/schema");
    const { and, eq, isNull } = await import("drizzle-orm");

    const keyId = crypto.randomUUID();
    const rawKey = "srv-key-redetect";
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
    await db.insert(serverKeys).values({ id: keyId, hash: keyHash, label: "redetect", createdAt: new Date() });
    await db.insert(packBundles).values({
      id: crypto.randomUUID(), serverId: keyId, packId: "p_re",
      hash: "h", filesJson: "{}", editorJson: "{}", createdAt: new Date(),
    });

    const { handlePluginMessage, connToServerId } = await import("./hub");
    const connId = crypto.randomUUID();
    connToServerId.set(connId, keyId);

    await handlePluginMessage(connId, JSON.stringify({
      type: "pack_divergence_detected",
      pack_id: "p_re", disk_files: { "a": "1" }, disk_hash: "d1", last_synced_hash: "s",
    }));
    await handlePluginMessage(connId, JSON.stringify({
      type: "pack_divergence_detected",
      pack_id: "p_re", disk_files: { "a": "2" }, disk_hash: "d2", last_synced_hash: "s",
    }));

    const open = await db.select().from(packConflicts).where(and(
      eq(packConflicts.serverId, keyId),
      eq(packConflicts.packId, "p_re"),
      isNull(packConflicts.resolvedAt),
    ));
    expect(open.length).toBe(1);
    expect(open[0].diskHash).toBe("d2");
  });

  test("skips upsert when pack is soft-deleted", async () => {
    const { db } = await import("../db/index");
    const { serverKeys, packBundles, packConflicts } = await import("../db/schema");
    const { and, eq } = await import("drizzle-orm");

    const keyId = crypto.randomUUID();
    const rawKey = "srv-key-del";
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
    await db.insert(serverKeys).values({ id: keyId, hash: keyHash, label: "deltest", createdAt: new Date() });
    await db.insert(packBundles).values({
      id: crypto.randomUUID(), serverId: keyId, packId: "p_del",
      hash: "h", filesJson: "{}", editorJson: "{}", deletedAt: new Date(), createdAt: new Date(),
    });

    const { handlePluginMessage, connToServerId } = await import("./hub");
    const connId = crypto.randomUUID();
    connToServerId.set(connId, keyId);

    await handlePluginMessage(connId, JSON.stringify({
      type: "pack_divergence_detected",
      pack_id: "p_del", disk_files: {}, disk_hash: "h", last_synced_hash: "",
    }));

    const rows = await db.select().from(packConflicts).where(and(
      eq(packConflicts.serverId, keyId),
      eq(packConflicts.packId, "p_del"),
    ));
    expect(rows.length).toBe(0);
  });
});
