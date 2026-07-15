import { beforeEach, describe, expect, test } from "bun:test";
import { app } from "../app";
import {
  handlePluginMessage,
  persistServerModules,
  persistServerDataSources,
  registerConn,
  registerEditorConn,
  broadcastDraftUpdate,
  getMcVersion,
  pushResourcePackUpdated,
  connToServerId,
  connSenders,
  requestDataSourceFetch,
} from "./hub";
import type { HelloMessage, HelloAckMessage, DataSourceFetchMessage } from "../protocol";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import {
  serverKeys,
  serverKeyHelloes,
  serverModules,
  serverDataSources,
  projects,
  projectBranches,
  projectCommits,
  networks,
  linkCodes,
  assets,
} from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { rebuildResourcePack } from "../lib/resourcePack";
import { createNetwork } from "../lib/networkManager";
import { createProject, upsertProjectContent, softDeleteProject } from "../lib/projectStorage";
import { getProject } from "../lib/projectStorage";
import { createCommit, computeContentHash } from "../lib/commitStorage";
import { advanceBranchHead, getBranch } from "../lib/branchStorage";

async function clearAll() {
  await db.delete(assets);
  await db.delete(projects);
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
  await createProject({ networkId, serverKeyId, name: packId, id: packId });
  await upsertProjectContent(packId, {
    hash,
    filesJson: JSON.stringify(files),
    editorJson: JSON.stringify(editor),
  });
  if (deleted) await softDeleteProject(packId);
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

describe("persistServerDataSources", () => {
  test("upserts reported sources and prunes the ones no longer reported", async () => {
    const networkId = crypto.randomUUID();
    await db.insert(networks).values({
      id: networkId,
      name: "presence-test-ds",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({
      id: keyId,
      hash: "h-ds",
      networkId,
      createdAt: new Date(),
    });

    await persistServerDataSources(keyId, [
      { ref: "boutique:items", schema_hint: "id, name, price" },
      { ref: "boutique:categories", schema_hint: null },
    ]);
    await persistServerDataSources(keyId, [{ ref: "boutique:items", schema_hint: "id, name" }]);
    const rows = await db.select().from(serverDataSources).where(eq(serverDataSources.serverKeyId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].ref).toBe("boutique:items");
    expect(rows[0].schemaHint).toBe("id, name");
  });

  test("persists module_id and schema_json, prunes as before", async () => {
    const networkId = crypto.randomUUID();
    await db.insert(networks).values({
      id: networkId, name: "presence-ds2", createdAt: new Date(), updatedAt: new Date(),
    });
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "h-ds2", networkId, createdAt: new Date() });

    await persistServerDataSources(keyId, [
      {
        ref: "boutique:items",
        module_id: "boutique",
        schema: [{ name: "price", type: "number", description: "Unit price" }],
        schema_hint: "id, price",
      },
      { ref: "core:stats" }, // legacy shape: no module_id, no schema
    ]);
    const rows = await db.select().from(serverDataSources).where(eq(serverDataSources.serverKeyId, keyId));
    const byRef = new Map(rows.map((r) => [r.ref, r]));
    expect(byRef.get("boutique:items")?.moduleId).toBe("boutique");
    expect(JSON.parse(byRef.get("boutique:items")?.schemaJson ?? "[]")).toEqual([
      { name: "price", type: "number", description: "Unit price" },
    ]);
    expect(byRef.get("core:stats")?.moduleId).toBeNull();
    expect(byRef.get("core:stats")?.schemaJson).toBeNull();

    // re-report clears stale enrichment
    await persistServerDataSources(keyId, [{ ref: "boutique:items" }]);
    const after = await db.select().from(serverDataSources).where(eq(serverDataSources.serverKeyId, keyId));
    expect(after).toHaveLength(1);
    expect(after[0].moduleId).toBeNull();
    expect(after[0].schemaJson).toBeNull();
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

  test("hello_ack carries editor_url and network_name", async () => {
    const { key } = await seedServerKey();
    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage("test-conn-editor-url", JSON.stringify(hello));
    const ack = JSON.parse(result.reply!) as HelloAckMessage;
    expect(ack.editor_url).toBeDefined();
    expect(typeof ack.editor_url).toBe("string");
    expect(ack.network_name).toBe("N");
  });

  test("hello_ack.server_url falls back to id-based path when server key has no slug", async () => {
    const { id, key, networkId } = await seedServerKey();
    const netRow = (await db.select().from(networks).where(eq(networks.id, networkId)))[0]!;
    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage("test-conn-server-url-id", JSON.stringify(hello));
    const ack = JSON.parse(result.reply!) as HelloAckMessage;
    expect(ack.server_url).toBe(`${ack.editor_url}/networks/${netRow.slug ?? netRow.id}/servers/${id}`);
  });

  test("hello_ack.server_url uses network and server key slugs when set", async () => {
    const { id, key, networkId } = await seedServerKey();
    await db.update(serverKeys).set({ slug: "my-server" }).where(eq(serverKeys.id, id));
    const netRow = (await db.select().from(networks).where(eq(networks.id, networkId)))[0]!;
    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage("test-conn-server-url-slug", JSON.stringify(hello));
    const ack = JSON.parse(result.reply!) as HelloAckMessage;
    expect(ack.server_url).toBe(`${ack.editor_url}/networks/${netRow.slug}/servers/my-server`);
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

  test("hello_ack contains project_hashes from branch → commit content hash", async () => {
    const { id: keyId, key, networkId } = await seedServerKey();
    await seedBoundPack(networkId, keyId, "pa", "ha");
    await seedBoundPack(networkId, keyId, "pb", "hb");

    // project_hashes reflect the main branch head commit contentHash (not WIP projects.hash).
    // createProject auto-creates main branch with an initial empty-files commit.
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
    expect(ack.project_hashes).toEqual({ pa: emptyHash, pb: emptyHash });
  });

  test("hello creates stubs for unknown local projects and advertises them as '' in the same ack", async () => {
    const { id: keyId, key } = await seedServerKey();
    // No bound projects — the plugin has "plocal" on disk that the backend doesn't know.

    const connId = "conn-local-stub";
    registerConn(connId, () => {});
    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
      local_project_ids: ["plocal"],
    };
    const result = await handlePluginMessage(connId, JSON.stringify(hello));
    const ack = JSON.parse(result.reply!) as HelloAckMessage;

    // Stub must exist AND be advertised in this same ack as "" so the plugin's
    // backendHash.isEmpty() auto-push fires on the first connect (no restart needed).
    expect(await getProject("plocal")).not.toBeNull();
    expect(ack.project_hashes["plocal"]).toBe("");
    void keyId;
  });

  test("hello_ack.project_hashes uses branch head commit contentHash (not WIP pack.hash)", async () => {
    const { id: keyId, key, networkId } = await seedServerKey();
    await seedBoundPack(networkId, keyId, "p_c2", "wip-hash");

    // Advance main branch head by creating a second commit with concrete files.
    const files = { "menus/shop.yaml": "id: shop\nsize: 27\n" };
    const branch = await getBranch("p_c2", "main");
    const commit2 = await createCommit({
      projectId: "p_c2",
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
    expect(ack.project_hashes["p_c2"]).toBe(commit2.contentHash);
    expect(ack.project_hashes["p_c2"]).not.toBe("wip-hash");
  });

  test("hello_ack includes soft-deleted pack ids", async () => {
    const { id: keyId, key, networkId } = await seedServerKey();
    await seedBoundPack(networkId, keyId, "alive", "ha");
    await seedBoundPack(networkId, keyId, "dead", "hd", {}, {}, true);

    // project_hashes uses branch head commit contentHash. Both projects start with empty-files initial commit.
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
    // In the 1:1 model, deleted projects are excluded from project_hashes (only non-deleted projects included).
    // Deleted pack still appears in deleted_project_ids so the plugin can trash it.
    expect(ack.project_hashes).toEqual({ alive: emptyHash });
    expect(ack.deleted_project_ids).toEqual(["dead"]);
  });
});

describe("broadcastDraftUpdate", () => {
  test("pushes draft_update to other editor connections for the same server", async () => {
    const { id: keyId } = await seedServerKey();

    const tokenA = crypto.randomUUID();
    const tokenB = crypto.randomUUID();

    const receivedByB: string[] = [];
    registerEditorConn(tokenA, keyId, () => {});
    registerEditorConn(tokenB, keyId, (msg) => receivedByB.push(msg));

    broadcastDraftUpdate(keyId, "pack1", "shop_main", "title: Shop\n", tokenA);

    expect(receivedByB.length).toBe(1);
    const msg = JSON.parse(receivedByB[0]) as { type: string; menu_id: string };
    expect(msg.type).toBe("draft_update");
    expect(msg.menu_id).toBe("shop_main");
  });

  test("delivers to a conn subscribed to multiple serverKeys, target key not first in the set", async () => {
    const { id: keyId } = await seedServerKey();
    const otherKeyId = "other-server-key-" + crypto.randomUUID().slice(0, 8);

    const tokenSender = crypto.randomUUID();
    const tokenMulti = crypto.randomUUID();

    const receivedByMulti: string[] = [];
    registerEditorConn(tokenSender, keyId, () => {});
    // otherKeyId listed first — the target keyId must still match via Set membership.
    registerEditorConn(tokenMulti, new Set([otherKeyId, keyId]), (msg) => receivedByMulti.push(msg));

    broadcastDraftUpdate(keyId, "pack1", "shop_main", "title: Shop\n", tokenSender);

    expect(receivedByMulti.length).toBe(1);
    const msg = JSON.parse(receivedByMulti[0]) as { type: string; menu_id: string };
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
      project_id: "p_pushed",
      files: { "menus/m.yaml": "id: m" },
      hash: "abc123",
    }));
    expect(result.reply).toBeNull();

    const pack = await getProject("p_pushed");
    expect(pack).not.toBeNull();
    expect(pack!.networkId).toBe(networkId);
    expect(pack!.hash).toBe("abc123");

    // Verify pack is owned by the server_key (1:1 model)
    expect(pack!.serverKeyId).toBe(keyId);

    // bundle_available should have been broadcast (received after the hello_ack push)
    const bundleMsg = received.map((m) => JSON.parse(m) as { type: string }).find((m) => m.type === "bundle_available");
    expect(bundleMsg).toBeDefined();
  });

  test("local_push commits to main and advances the branch head (bundle download serves the pushed files)", async () => {
    const { key } = await seedServerKey();
    const connId = "conn-local-push-commit";
    const received: string[] = [];
    registerConn(connId, (msg) => received.push(msg));
    await handlePluginMessage(connId, JSON.stringify({
      type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "",
    }));

    const files = { "manifest.yaml": "schema: manifest/v1", "menus/m.yaml": "id: m" };
    await handlePluginMessage(connId, JSON.stringify({
      type: "local_push", project_id: "p_commit", files, hash: "whatever",
    }));

    // Le plugin télécharge les bundles via branche main → head commit : sans
    // commit, il recevrait le commit initial vide et le sweep détruirait le
    // contenu local (trouvé au smoke test Docker 2026-07-09).
    const branch = (await db.select().from(projectBranches).where(and(
      eq(projectBranches.projectId, "p_commit"), eq(projectBranches.name, "main"),
    )))[0];
    expect(branch).toBeDefined();
    const head = (await db.select().from(projectCommits).where(eq(projectCommits.id, branch.headCommitId)))[0];
    expect(JSON.parse(head.filesJson)).toEqual(files);
    expect(head.contentHash).not.toBe("");

    // Le bundle_available broadcast porte le contentHash du commit (même
    // convention que le deploy), pas le hash brut envoyé par le plugin.
    const bundleMsg = received.map((m) => JSON.parse(m) as { type: string; hash?: string })
      .find((m) => m.type === "bundle_available");
    expect(bundleMsg?.hash).toBe(head.contentHash);
  });

  test("local_push unauthenticated → ignored", async () => {
    const connId = "conn-local-push-unauth";
    registerConn(connId, () => {});
    const result = await handlePluginMessage(connId, JSON.stringify({
      type: "local_push", project_id: "p", files: {}, hash: "h",
    }));
    expect(result.reply).toBeNull();
  });

  test("local_push on an empty stub builds editorJson from files (incl. moduleData)", async () => {
    const { key } = await seedServerKey();
    const connId = "conn-local-push-stub";
    registerConn(connId, () => {});

    await handlePluginMessage(connId, JSON.stringify({
      type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "",
    }));

    const base = "plugins/Artisan/projects/p_stub";
    const result = await handlePluginMessage(connId, JSON.stringify({
      type: "local_push",
      project_id: "p_stub",
      files: {
        [`${base}/manifest.yaml`]: "schema: manifest/v1\nproject_id: p_stub\ndefault_lang: en\nfiles:\n  menus: [shop]\n  commands: []\n  dialogs: []\n",
        [`${base}/menus/shop.yaml`]: "id: shop\nsize: 27\n",
        [`${base}/boutique/shop.yaml`]: "schema: boutique/v1\ncategories: []\n",
      },
      hash: "hash-stub",
    }));
    expect(result.reply).toBeNull();

    const pack = await getProject("p_stub");
    expect(pack).not.toBeNull();
    expect(pack!.editorJson).not.toBeNull();
    const editor = JSON.parse(pack!.editorJson!) as {
      moduleData?: Record<string, { __files: Record<string, string> }>;
    };
    expect(editor.moduleData?.boutique.__files["shop.yaml"]).toContain("boutique/v1");
  });

  test("local_push on a real editor project does NOT overwrite editorJson", async () => {
    const { id: keyId, key, networkId } = await seedServerKey();
    const connId = "conn-local-push-real";
    registerConn(connId, () => {});

    await handlePluginMessage(connId, JSON.stringify({
      type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "",
    }));

    const realEditorJson = JSON.stringify({
      id: "p_real",
      name: "p_real",
      source: "user_created",
      menus: [{ id: "shop", title: { key: "menus.shop.title" }, rows: 3, layers: [] }],
      commands: [],
      dialogs: [],
    });
    await db.insert(projects).values({
      id: "p_real",
      networkId,
      serverKeyId: keyId,
      name: "p_real",
      slug: "p-real",
      hash: "",
      filesJson: "{}",
      editorJson: realEditorJson,
      deployedEditorJson: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await handlePluginMessage(connId, JSON.stringify({
      type: "local_push",
      project_id: "p_real",
      files: { "menus/shop.yaml": "id: shop\nsize: 27\n" },
      hash: "hash-real",
    }));
    expect(result.reply).toBeNull();

    const pack = await getProject("p_real");
    expect(pack!.editorJson).toBe(realEditorJson);
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

describe("requestDataSourceFetch", () => {
  test("resolves offline when no plugin conn is bound to the server key", async () => {
    const outcome = await requestDataSourceFetch("sk-not-connected", { ref: "boutique:items" });
    expect(outcome).toEqual({ kind: "offline" });
  });

  test("sends data_source_fetch and resolves on the correlated result — two concurrent requests", async () => {
    const sent: DataSourceFetchMessage[] = [];
    registerConn("connX", (raw) => sent.push(JSON.parse(raw)));
    connToServerId.set("connX", "sk-live");
    try {
      const p1 = requestDataSourceFetch("sk-live", { ref: "a:one", filter: { k: "v" } });
      const p2 = requestDataSourceFetch("sk-live", { ref: "b:two" });
      expect(sent).toHaveLength(2);
      expect(sent[0].type).toBe("data_source_fetch");
      expect(sent[0].ref).toBe("a:one");
      expect(sent[0].filter).toEqual({ k: "v" });
      expect(sent[0].sort).toBeNull();
      expect(sent[0].limit).toBeNull();
      expect(sent[0].args).toEqual({});

      // Answer out of order: second request first.
      await handlePluginMessage("connX", JSON.stringify({
        type: "data_source_fetch_result", request_id: sent[1].request_id,
        ok: true, rows: [{ id: "two" }], truncated: false,
      }));
      await handlePluginMessage("connX", JSON.stringify({
        type: "data_source_fetch_result", request_id: sent[0].request_id,
        ok: true, rows: [{ id: "one" }], truncated: true,
      }));

      const [o1, o2] = await Promise.all([p1, p2]);
      expect(o1).toEqual({
        kind: "result",
        result: { type: "data_source_fetch_result", request_id: sent[0].request_id, ok: true, rows: [{ id: "one" }], truncated: true },
      });
      expect(o2.kind).toBe("result");
      if (o2.kind === "result") expect(o2.result.rows).toEqual([{ id: "two" }]);
    } finally {
      connToServerId.delete("connX");
      connSenders.delete("connX");
    }
  });

  test("resolves timeout when the plugin never answers", async () => {
    registerConn("connY", () => {});
    connToServerId.set("connY", "sk-slow");
    try {
      const outcome = await requestDataSourceFetch("sk-slow", { ref: "a:one" }, 20);
      expect(outcome).toEqual({ kind: "timeout" });
    } finally {
      connToServerId.delete("connY");
      connSenders.delete("connY");
    }
  });

  test("a late result after timeout is ignored (no crash, unknown request_id)", async () => {
    const sent: DataSourceFetchMessage[] = [];
    registerConn("connZ", (raw) => sent.push(JSON.parse(raw)));
    connToServerId.set("connZ", "sk-late");
    try {
      await requestDataSourceFetch("sk-late", { ref: "a:one" }, 10);
      const res = await handlePluginMessage("connZ", JSON.stringify({
        type: "data_source_fetch_result", request_id: sent[0].request_id, ok: true, rows: [],
      }));
      expect(res.reply).toBeNull();
    } finally {
      connToServerId.delete("connZ");
      connSenders.delete("connZ");
    }
  });
});

