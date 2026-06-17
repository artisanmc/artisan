import { beforeEach, describe, expect, test } from "bun:test";
import { app } from "../app";
import {
  handlePluginMessage,
  persistServerModules,
  registerConn,
  registerEditorConn,
  broadcastDraftUpdate,
  getMcVersion,
  trackEditorIp,
  pushResourcePackUpdated,
  connToServerId,
  connSenders,
} from "./hub";
import type { HelloMessage, HelloAckMessage } from "../protocol";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import {
  editorSessions,
  serverKeys,
  serverKeyHelloes,
  serverModules,
  packs,
  networks,
  linkCodes,
  assets,
} from "../db/schema";
import { generateEditorToken, generateServerKey, generateTrustCode } from "../lib/auth";
import { rebuildResourcePack } from "../lib/resourcePack";
import { createNetwork } from "../lib/networkManager";
import { createPack, upsertPackContent, softDeletePack } from "../lib/packStorage";
import { getPack } from "../lib/packStorage";
import { createCommit, computeContentHash } from "../lib/commitStorage";
import { advanceBranchHead, getBranch } from "../lib/branchStorage";

async function clearAll() {
  await db.delete(assets);
  await db.delete(packs);
  await db.delete(editorSessions);
  await db.delete(linkCodes);
  await db.delete(serverKeyHelloes);
  await db.delete(serverKeys);
  await db.delete(networks);
}

async function seedServerKey(): Promise<{ id: string; key: string; hash: string; networkId: string }> {
  const net = await createNetwork("N");
  const { id, key, hash } = await generateServerKey();
  await db.insert(serverKeys).values({
    id, hash, label: null, networkId: net.id, createdAt: new Date(),
  });
  return { id, key, hash, networkId: net.id };
}

async function seedBoundPack(
  networkId: string,
  serverKeyId: string,
  packId: string,
  hash: string,
  files: Record<string, string> = {},
  editor: Record<string, unknown> = {},
  deleted = false,
): Promise<void> {
  await createPack({ networkId, serverKeyId, name: packId, id: packId });
  await upsertPackContent(packId, {
    hash,
    filesJson: JSON.stringify(files),
    editorJson: JSON.stringify(editor),
  });
  if (deleted) await softDeletePack(packId);
}

beforeEach(clearAll);

describe("persistServerModules (presence)", () => {
  test("upserts the reported set and prunes modules no longer reported", async () => {
    const networkId = crypto.randomUUID();
    await db.insert(networks).values({
      id: networkId,
      name: "presence-test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({
      id: keyId,
      hash: "h",
      networkId,
      createdAt: new Date(),
    });

    await persistServerModules(keyId, [
      { id: "menus", version: "1.0" },
      { id: "shop", version: "2.0" },
    ]);
    let rows = await db.select().from(serverModules).where(eq(serverModules.serverKeyId, keyId));
    expect(rows.map((r) => r.moduleId).sort()).toEqual(["menus", "shop"]);

    // Re-report without "shop", bump menus → shop pruned, menus version updated.
    await persistServerModules(keyId, [{ id: "menus", version: "1.1" }]);
    rows = await db.select().from(serverModules).where(eq(serverModules.serverKeyId, keyId));
    expect(rows.map((r) => r.moduleId)).toEqual(["menus"]);
    expect(rows[0]?.version).toBe("1.1");
  });
});

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
    const createRes = await app.request("/api/v1/server-keys", {
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

  test("hello inserts a row into server_key_helloes (audit log) with the source IP", async () => {
    const { id: keyId, key } = await seedServerKey();
    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    await handlePluginMessage("test-conn-audit", JSON.stringify(hello), "203.0.113.42");
    // The insert is fire-and-forget — wait a tick for it to land.
    await new Promise((r) => setTimeout(r, 50));

    const rows = await db.select().from(serverKeyHelloes).where(eq(serverKeyHelloes.serverKeyId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].ip).toBe("203.0.113.42");
    expect(rows[0].mcVersion).toBe("1.21.4");
    expect(rows[0].helloAt).toBeInstanceOf(Date);
  });

  test("hello with an unknown key does NOT insert an audit row", async () => {
    const hello: HelloMessage = {
      type: "hello",
      server_key: "sk_bogus",
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    await handlePluginMessage("test-conn-noaudit", JSON.stringify(hello), "198.51.100.7");
    await new Promise((r) => setTimeout(r, 50));
    const rows = await db.select().from(serverKeyHelloes);
    expect(rows).toHaveLength(0);
  });

  test("allowlist gate — IP in the list is accepted", async () => {
    const { id: keyId, key } = await seedServerKey();
    await db.update(serverKeys).set({ allowedIps: ["203.0.113.10"] }).where(eq(serverKeys.id, keyId));
    const hello: HelloMessage = {
      type: "hello", server_key: key, plugin_version: "1.0.0",
      minecraft_version: "1.21.4", current_bundle_hash: "",
    };
    const result = await handlePluginMessage("conn-allow-ok", JSON.stringify(hello), "203.0.113.10");
    expect(result.reply).not.toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    const rows = await db.select().from(serverKeyHelloes).where(eq(serverKeyHelloes.serverKeyId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].rejectedReason).toBeNull();
  });

  test("allowlist gate — IP NOT in the list is rejected and logged with rejected_reason", async () => {
    const { id: keyId, key } = await seedServerKey();
    await db.update(serverKeys).set({ allowedIps: ["203.0.113.10"] }).where(eq(serverKeys.id, keyId));
    const hello: HelloMessage = {
      type: "hello", server_key: key, plugin_version: "1.0.0",
      minecraft_version: "1.21.4", current_bundle_hash: "",
    };
    const result = await handlePluginMessage("conn-allow-bad", JSON.stringify(hello), "198.51.100.99");
    expect(result.reply).toBeNull();
    // Conn should NOT be authenticated.
    expect(connToServerId.get("conn-allow-bad")).toBeUndefined();
    await new Promise((r) => setTimeout(r, 50));
    const rows = await db.select().from(serverKeyHelloes).where(eq(serverKeyHelloes.serverKeyId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].rejectedReason).toBe("ip_not_allowed");
    expect(rows[0].ip).toBe("198.51.100.99");
  });

  test("empty allowlist behaves like no restriction", async () => {
    const { id: keyId, key } = await seedServerKey();
    await db.update(serverKeys).set({ allowedIps: [] }).where(eq(serverKeys.id, keyId));
    const hello: HelloMessage = {
      type: "hello", server_key: key, plugin_version: "1.0.0",
      minecraft_version: "1.21.4", current_bundle_hash: "",
    };
    const result = await handlePluginMessage("conn-allow-empty", JSON.stringify(hello), "1.2.3.4");
    expect(result.reply).not.toBeNull();
  });

  test("hello_ack contains pack_hashes from branch → commit content hash", async () => {
    const { id: keyId, key, networkId } = await seedServerKey();
    await seedBoundPack(networkId, keyId, "pa", "ha");
    await seedBoundPack(networkId, keyId, "pb", "hb");

    // pack_hashes reflect the main branch head commit contentHash (not WIP packs.hash).
    // createPack auto-creates main branch with an initial empty-files commit.
    const emptyHash = computeContentHash({});

    const connId = "conn-hashes";
    registerConn(connId, () => {});
    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage(connId, JSON.stringify(hello));
    const ack = JSON.parse(result.reply!) as HelloAckMessage;
    expect(ack.pack_hashes).toEqual({ pa: emptyHash, pb: emptyHash });
  });

  test("hello_ack.pack_hashes uses branch head commit contentHash (not WIP pack.hash)", async () => {
    const { id: keyId, key, networkId } = await seedServerKey();
    await seedBoundPack(networkId, keyId, "p_c2", "wip-hash");

    // Advance main branch head by creating a second commit with concrete files.
    const files = { "menus/shop.yaml": "id: shop\nsize: 27\n" };
    const branch = await getBranch("p_c2", "main");
    const commit2 = await createCommit({
      packId: "p_c2",
      parentId: branch!.headCommitId,
      files,
      editor: null,
      authorUserId: null,
      message: "C2 test commit",
    });
    await advanceBranchHead("p_c2", "main", commit2.id);

    const connId = "conn-c2-hashes";
    registerConn(connId, () => {});
    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage(connId, JSON.stringify(hello));
    const ack = JSON.parse(result.reply!) as HelloAckMessage;
    // Should match commit2's contentHash, NOT "wip-hash"
    expect(ack.pack_hashes["p_c2"]).toBe(commit2.contentHash);
    expect(ack.pack_hashes["p_c2"]).not.toBe("wip-hash");
  });

  test("hello_ack includes soft-deleted pack ids", async () => {
    const { id: keyId, key, networkId } = await seedServerKey();
    await seedBoundPack(networkId, keyId, "alive", "ha");
    await seedBoundPack(networkId, keyId, "dead", "hd", {}, {}, true);

    // pack_hashes uses branch head commit contentHash. Both packs start with empty-files initial commit.
    const emptyHash = computeContentHash({});

    const connId = "conn-deleted";
    registerConn(connId, () => {});
    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage(connId, JSON.stringify(hello));
    const ack = JSON.parse(result.reply!) as HelloAckMessage;
    // In the 1:1 model, deleted packs are excluded from pack_hashes (only non-deleted packs included).
    // Deleted pack still appears in deleted_pack_ids so the plugin can trash it.
    expect(ack.pack_hashes).toEqual({ alive: emptyHash });
    expect(ack.deleted_pack_ids).toEqual(["dead"]);
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
    const createRes = await app.request("/api/v1/link", { method: "POST" });
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

    const { key } = await seedServerKey();
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
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
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

    const { id: keyId, key } = await seedServerKey();
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

describe("editor_trust_request", () => {
  test("sets trusted_at + trusted_ip, pushes session_trusted to editor WS", async () => {
    const connId = "conn-trust-test";
    registerConn(connId, () => {});

    const { id: keyId, key } = await seedServerKey();
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
    const { key } = await seedServerKey();
    await handlePluginMessage(connId, JSON.stringify({
      type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "",
    }));
    const result = await handlePluginMessage(connId, JSON.stringify({ type: "editor_trust_request", trust_code: "XXXXXX" }));
    expect(result.reply).toBeNull();
  });
});

describe("broadcastDraftUpdate", () => {
  test("pushes draft_update to other editor connections for the same server", async () => {
    const { id: keyId } = await seedServerKey();

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
    const createRes = await app.request("/api/v1/server-keys", {
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
    const { key } = await seedServerKey();

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
    const { id: keyId, key } = await seedServerKey();

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

    connSenders.delete(connA);
    connSenders.delete(connB);
    connToServerId.delete(connA);
    connToServerId.delete(connB);
  });
});

describe("local_push", () => {
  test("creates pack + binding if missing, upserts content, broadcasts bundle_available", async () => {
    const { id: keyId, key, networkId } = await seedServerKey();
    const connId = "conn-local-push";
    const received: string[] = [];
    registerConn(connId, (msg) => received.push(msg));

    // Authenticate via hello first
    await handlePluginMessage(connId, JSON.stringify({
      type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "",
    }));

    const result = await handlePluginMessage(connId, JSON.stringify({
      type: "local_push",
      pack_id: "p_pushed",
      files: { "menus/m.yaml": "id: m" },
      hash: "abc123",
    }));
    expect(result.reply).toBeNull();

    const pack = await getPack("p_pushed");
    expect(pack).not.toBeNull();
    expect(pack!.networkId).toBe(networkId);
    expect(pack!.hash).toBe("abc123");

    // Verify pack is owned by the server_key (1:1 model)
    expect(pack!.serverKeyId).toBe(keyId);

    // bundle_available should have been broadcast (received after the hello_ack push)
    const bundleMsg = received.map((m) => JSON.parse(m) as { type: string }).find((m) => m.type === "bundle_available");
    expect(bundleMsg).toBeDefined();
  });

  test("local_push unauthenticated → ignored", async () => {
    const connId = "conn-local-push-unauth";
    registerConn(connId, () => {});
    const result = await handlePluginMessage(connId, JSON.stringify({
      type: "local_push", pack_id: "p", files: {}, hash: "h",
    }));
    expect(result.reply).toBeNull();
  });
});

describe("protocol_version + unknown message types", () => {
  test("handlePluginMessage logs and ignores unknown message types", async () => {
    const connId = "conn-unknown-type";
    registerConn(connId, () => {});
    const result = await handlePluginMessage(connId, JSON.stringify({
      type: "future_message_type_v99",
      foo: "bar",
    }));
    expect(result.reply).toBeNull();
  });

  test("hello with protocol_version 1 + core_version is accepted", async () => {
    const connId = "conn-protocol-v1";
    registerConn(connId, () => {});
    const { key } = await seedServerKey();
    const result = await handlePluginMessage(connId, JSON.stringify({
      type: "hello",
      protocol_version: "1",
      core_version: "1.0.0",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    }));
    expect(result.reply).not.toBeNull();
    const reply = JSON.parse(result.reply!);
    expect(reply.type).toBe("hello_ack");
  });
});

describe("modules_changed", () => {
  test("updates server_modules for an already-authenticated connection", async () => {
    const connId = "conn-modules-changed";
    registerConn(connId, () => {});
    const { id: keyId, key } = await seedServerKey();

    // Authenticate via hello first (installs menus/1.0)
    await handlePluginMessage(connId, JSON.stringify({
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
      installed_modules: [{ id: "menus", version: "1.0.0" }],
    }));
    // Fire-and-forget persistServerModules from hello — wait for it
    await new Promise((r) => setTimeout(r, 50));

    // Now a new module registers at runtime and sends modules_changed
    const result = await handlePluginMessage(connId, JSON.stringify({
      type: "modules_changed",
      server_key: key,
      installed_modules: [
        { id: "menus", version: "1.0.0" },
        { id: "quests", version: "0.1.0" },
      ],
    }));
    expect(result.reply).toBeNull();

    // Wait for the async persistServerModules to land
    await new Promise((r) => setTimeout(r, 50));

    const rows = await db.select().from(serverModules).where(eq(serverModules.serverKeyId, keyId));
    expect(rows.map((r) => r.moduleId).sort()).toEqual(["menus", "quests"]);
    expect(rows.find((r) => r.moduleId === "quests")?.version).toBe("0.1.0");
  });

  test("modules_changed from unauthenticated connection is ignored", async () => {
    const connId = "conn-modules-changed-unauth";
    registerConn(connId, () => {});

    const result = await handlePluginMessage(connId, JSON.stringify({
      type: "modules_changed",
      installed_modules: [{ id: "quests", version: "0.1.0" }],
    }));
    expect(result.reply).toBeNull();
    // No rows should have been written (connection was never authenticated)
    const rows = await db.select().from(serverModules);
    expect(rows).toHaveLength(0);
  });
});

