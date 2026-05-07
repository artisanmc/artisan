import { describe, expect, test } from "bun:test";
import { app } from "../app";
import { handlePluginMessage, registerConn, registerEditorConn, cleanupEditorConn, broadcastDraftUpdate, getMcVersion } from "./hub";
import type { HelloMessage, HelloAckMessage } from "../protocol";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";
import { generateEditorToken, generateServerKey } from "../lib/auth";

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
    expect(new Date(msg.expires_at).getTime()).toBeGreaterThan(Date.now());
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
    registerEditorConn(token, keyId, (msg) => editorReceived.push(msg));

    await handlePluginMessage(connId, JSON.stringify({ type: "editor_session_revoke" }));

    expect(editorReceived.length).toBe(1);
    expect(JSON.parse(editorReceived[0])).toMatchObject({ type: "session_expired" });
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
