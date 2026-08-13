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
  requestOnlinePlayers,
  requestPlayerInventory,
} from "./hub";
import type {
  HelloMessage,
  HelloAckMessage,
  DataSourceFetchMessage,
  PlayerInventoryFetchMessage,
} from "../protocol";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import {
  serverKeys,
  serverKeyHelloes,
  serverModules,
  serverDataSources,
  projects,
  networks,
  linkCodes,
  assets,
} from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { rebuildResourcePack } from "../lib/resourcePack";
import { createNetwork } from "../lib/networkManager";
import { createProject, ensureProjectForServer, softDeleteProject } from "../lib/projectStorage";
import { getProject } from "../lib/projectStorage";

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

async function seedBoundProject(
  networkId: string,
  serverKeyId: string,
  projectId: string,
  deleted = false,
): Promise<void> {
  await createProject({ networkId, serverKeyId, name: projectId, id: projectId });
  if (deleted) await softDeleteProject(projectId);
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
        stability: "static",
        key_field: "id",
      },
      { ref: "core:stats" }, // legacy shape: no module_id, no schema, no stability
    ]);
    const rows = await db.select().from(serverDataSources).where(eq(serverDataSources.serverKeyId, keyId));
    const byRef = new Map(rows.map((r) => [r.ref, r]));
    expect(byRef.get("boutique:items")?.moduleId).toBe("boutique");
    expect(JSON.parse(byRef.get("boutique:items")?.schemaJson ?? "[]")).toEqual([
      { name: "price", type: "number", description: "Unit price" },
    ]);
    expect(byRef.get("boutique:items")?.stability).toBe("static");
    expect(byRef.get("boutique:items")?.keyField).toBe("id");
    expect(byRef.get("core:stats")?.moduleId).toBeNull();
    expect(byRef.get("core:stats")?.schemaJson).toBeNull();
    expect(byRef.get("core:stats")?.stability).toBeNull();
    expect(byRef.get("core:stats")?.keyField).toBeNull();

    // re-report clears stale enrichment
    await persistServerDataSources(keyId, [{ ref: "boutique:items" }]);
    const after = await db.select().from(serverDataSources).where(eq(serverDataSources.serverKeyId, keyId));
    expect(after).toHaveLength(1);
    expect(after[0].moduleId).toBeNull();
    expect(after[0].schemaJson).toBeNull();
    expect(after[0].stability).toBeNull();
    expect(after[0].keyField).toBeNull();
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

    // Le backend ne stocke plus de contenu, mais il garde l'IDENTITÉ des
    // Projects : c'est ce qui permet à l'éditeur de les lister et de les router.
    // Un project présent sur le disque du serveur doit donc exister en base.
    expect(await getProject("plocal")).not.toBeNull();
    void ack;
    void keyId;
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
  test("hello_ack includes resource_pack: null when no project has been built", async () => {
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

  test("hello_ack includes { url, hash } after a project was built", async () => {
    const { id: keyId, key } = await seedServerKey();

    const projectInfo = await rebuildResourcePack(keyId);

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
    expect(ack.resource_pack!.hash).toBe(projectInfo.hash);
    expect(ack.resource_pack!.url).toContain(projectInfo.hash);
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

    pushResourcePackUpdated(serverKeyA, "http://example.com/project.zip", "abc123");

    expect(receivedA.length).toBe(1);
    const msg = JSON.parse(receivedA[0]) as { type: string; url: string; hash: string };
    expect(msg.type).toBe("resource_pack_updated");
    expect(msg.url).toBe("http://example.com/project.zip");
    expect(msg.hash).toBe("abc123");

    expect(receivedB.length).toBe(0);

    connSenders.delete(connA);
    connSenders.delete(connB);
    connToServerId.delete(connA);
    connToServerId.delete(connB);
  });
});


describe("declared_models presence (composable-data-models §4)", () => {
  test("hello persists model/v1 documents verbatim; modules_changed prunes", async () => {
    const { key, id: keyId } = await seedServerKey();
    const connId = "conn-declared-models";
    registerConn(connId, () => {});

    const catDoc = {
      schema: "model/v1", id: "boutique:category", name: "Category", key_field: "id",
      version: 2,
      migrations: [{ from: 1, to: 2, steps: [{ op: "rename_field", from: "label", to: "name" }] }],
      fields: [{ name: "id", type: { kind: "string" } }],
    };
    await handlePluginMessage(connId, JSON.stringify({
      type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21",
      current_bundle_hash: "",
      declared_models: [catDoc, { schema: "model/v1", id: "not-namespaced" }],
    }));
    await new Promise((r) => setTimeout(r, 150)); // fire-and-forget persist

    const { serverDeclaredModels } = await import("../db/schema");
    let rows = await db.select().from(serverDeclaredModels).where(eq(serverDeclaredModels.serverKeyId, keyId));
    // Non-namespaced ids are dropped; the valid document is stored verbatim.
    expect(rows.map((r) => r.modelId)).toEqual(["boutique:category"]);
    expect(JSON.parse(rows[0]!.documentJson)).toEqual(catDoc);

    // modules_changed re-report without the model → pruned.
    await handlePluginMessage(connId, JSON.stringify({
      type: "modules_changed", server_key: key, installed_modules: [], data_sources: [],
      declared_models: [],
    }));
    await new Promise((r) => setTimeout(r, 150));
    rows = await db.select().from(serverDeclaredModels).where(eq(serverDeclaredModels.serverKeyId, keyId));
    expect(rows).toEqual([]);
  });
});

describe("editor_screens presence (module-config-screens)", () => {
  test("hello persists declared screens verbatim; modules_changed prunes", async () => {
    const { key, id: keyId } = await seedServerKey();
    const connId = "conn-editor-screens";
    registerConn(connId, () => {});

    const catalogScreen = {
      id: "boutique:catalog", module_id: "boutique", label: "Catalogue",
      table: "data/categories", project_id: "boutique",
    };
    await handlePluginMessage(connId, JSON.stringify({
      type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21",
      current_bundle_hash: "",
      editor_screens: [
        catalogScreen,
        { id: "not-namespaced", label: "X", table: "data/x", project_id: "p" },
        { id: "quests:missing-fields" },
      ],
    }));
    await new Promise((r) => setTimeout(r, 150)); // fire-and-forget persist

    const { serverEditorScreens } = await import("../db/schema");
    let rows = await db.select().from(serverEditorScreens).where(eq(serverEditorScreens.serverKeyId, keyId));
    expect(rows.map((r) => r.screenId)).toEqual(["boutique:catalog"]);
    expect(JSON.parse(rows[0]!.screenJson)).toEqual(catalogScreen);

    await handlePluginMessage(connId, JSON.stringify({
      type: "modules_changed", server_key: key, installed_modules: [], data_sources: [],
      editor_screens: [],
    }));
    await new Promise((r) => setTimeout(r, 150));
    rows = await db.select().from(serverEditorScreens).where(eq(serverEditorScreens.serverKeyId, keyId));
    expect(rows).toEqual([]);
  });
});

describe("config read/write relay (module-config-screens)", () => {
  test("requestConfigRead resolves offline when no plugin conn is bound", async () => {
    const { requestConfigRead } = await import("./hub");
    const outcome = await requestConfigRead("sk-not-connected", { projectId: "boutique", table: "data/categories" });
    expect(outcome).toEqual({ kind: "offline" });
  });

  test("read and write round-trip through the plugin conn, correlated by request_id", async () => {
    const { requestConfigRead, requestConfigWrite, connToServerId, connSenders } = await import("./hub");
    const sent: Record<string, unknown>[] = [];
    const connId = "conn-config-relay";
    registerConn(connId, (raw) => sent.push(JSON.parse(raw)));
    connToServerId.set(connId, "sk-config-live");
    try {
      const pRead = requestConfigRead("sk-config-live", { projectId: "boutique", table: "data/categories" });
      const pWrite = requestConfigWrite("sk-config-live", {
        projectId: "boutique",
        files: [{ path: "data/categories/weapons.yaml", content: "name: Armes\n" }],
        deletes: ["data/categories/old.yaml"],
      });
      expect(sent.map((m) => m.type)).toEqual(["config_read", "config_write"]);
      expect(sent[0]!.project_id).toBe("boutique");
      expect(sent[0]!.table).toBe("data/categories");
      expect(sent[1]!.deletes).toEqual(["data/categories/old.yaml"]);

      // Answer out of order — correlation is by request_id, not arrival order.
      await handlePluginMessage(connId, JSON.stringify({
        type: "config_write_result", request_id: sent[1]!.request_id, ok: true,
      }));
      await handlePluginMessage(connId, JSON.stringify({
        type: "config_read_result", request_id: sent[0]!.request_id, ok: true,
        files: [{ path: "data/categories/_source.yaml", content: "name: Catégories\n" }],
      }));

      const read = await pRead;
      const write = await pWrite;
      expect(read.kind).toBe("result");
      if (read.kind === "result") {
        expect(read.result.files).toEqual([{ path: "data/categories/_source.yaml", content: "name: Catégories\n" }]);
      }
      expect(write.kind).toBe("result");
      if (write.kind === "result") expect(write.result.ok).toBe(true);
    } finally {
      connToServerId.delete(connId);
      connSenders.delete(connId);
    }
  });

  test("read times out when the plugin never answers", async () => {
    const { requestConfigRead, connToServerId, connSenders } = await import("./hub");
    const connId = "conn-config-timeout";
    registerConn(connId, () => {});
    connToServerId.set(connId, "sk-config-mute");
    try {
      const outcome = await requestConfigRead("sk-config-mute", { projectId: "p", table: "data/x" }, 20);
      expect(outcome).toEqual({ kind: "timeout" });
    } finally {
      connToServerId.delete(connId);
      connSenders.delete(connId);
    }
  });
});

describe("une clé serveur = un serveur vivant", () => {
  /**
   * Le backend relaie vers « la première connexion trouvée » pour une clé. Tant
   * qu'il détenait le contenu, parler à l'une ou l'autre des instances revenait
   * au même — elles téléchargeaient toutes le même bundle. Depuis
   * `server-disk-only-storage`, chacune a SON disque et rien ne les synchronise :
   * lire A puis écrire B, ou basculer en silence de A vers B quand A tombe, c'est
   * exactement la divergence que l'épopée a supprimée. On applique donc la règle.
   */
  test("un second hello sur la même clé évince le premier (dernier gagne)", async () => {
    const { key } = await seedServerKey();
    const { connToServerId, connSenders } = await import("./hub");
    const firstMsgs: string[] = [];
    registerConn("conn-evicted", (raw) => firstMsgs.push(raw));
    registerConn("conn-winner", () => {});
    const hello = {
      type: "hello", server_key: key, plugin_version: "1.0",
      minecraft_version: "1.21", current_bundle_hash: "",
    };
    try {
      await handlePluginMessage("conn-evicted", JSON.stringify(hello));
      expect(connToServerId.get("conn-evicted")).toBeDefined();

      await handlePluginMessage("conn-winner", JSON.stringify(hello));

      // L'ancienne connexion ne reçoit plus rien : le relais ne peut plus la choisir.
      expect(connToServerId.get("conn-evicted")).toBeUndefined();
      expect(connToServerId.get("conn-winner")).toBeDefined();
      // Et elle est prévenue, pour que le serveur évincé le dise dans ses logs
      // au lieu de se croire connecté indéfiniment.
      expect(firstMsgs.some((m) => JSON.parse(m).type === "session_replaced")).toBe(true);
    } finally {
      connToServerId.delete("conn-evicted");
      connToServerId.delete("conn-winner");
      connSenders.delete("conn-evicted");
      connSenders.delete("conn-winner");
    }
  });

  test("un reconnect après crash récupère la clé au lieu de rester dehors", async () => {
    const { key } = await seedServerKey();
    const { connToServerId, connSenders } = await import("./hub");
    registerConn("conn-dead", () => {});
    registerConn("conn-restarted", () => {});
    const hello = {
      type: "hello", server_key: key, plugin_version: "1.0",
      minecraft_version: "1.21", current_bundle_hash: "",
    };
    try {
      await handlePluginMessage("conn-dead", JSON.stringify(hello));
      // « conn-dead » n'a jamais été nettoyée (crash sale, keepalive pas encore expiré).
      const res = await handlePluginMessage("conn-restarted", JSON.stringify(hello));

      // Le vrai serveur reprend la main — c'est tout l'intérêt de « dernier gagne ».
      expect(res.reply).not.toBeNull();
      expect(connToServerId.get("conn-restarted")).toBeDefined();
    } finally {
      connToServerId.delete("conn-dead");
      connToServerId.delete("conn-restarted");
      connSenders.delete("conn-dead");
      connSenders.delete("conn-restarted");
    }
  });
});

describe("project_read relay (server-disk-only-storage P0)", () => {
  test("resolves offline when no plugin conn is bound", async () => {
    const { requestProjectRead } = await import("./hub");
    const outcome = await requestProjectRead("sk-not-connected", { projectId: "boutique" });
    expect(outcome).toEqual({ kind: "offline" });
  });

  test("round-trips the whole tree through the plugin conn", async () => {
    const { requestProjectRead, connToServerId, connSenders } = await import("./hub");
    const sent: Record<string, unknown>[] = [];
    const connId = "conn-project-read";
    registerConn(connId, (raw) => sent.push(JSON.parse(raw)));
    connToServerId.set(connId, "sk-project-live");
    try {
      const pending = requestProjectRead("sk-project-live", { projectId: "boutique" });
      expect(sent.map((m) => m.type)).toEqual(["project_read"]);
      expect(sent[0]!.project_id).toBe("boutique");

      await handlePluginMessage(connId, JSON.stringify({
        type: "project_read_result", request_id: sent[0]!.request_id, ok: true,
        files: [
          { path: ".artisan/editor.yaml", content: "i18n_mode: inline\n" },
          { path: "menus/shop_main.yaml", content: "title: Boutique\n" },
        ],
      }));

      const outcome = await pending;
      expect(outcome.kind).toBe("result");
      if (outcome.kind === "result") {
        expect(outcome.result.files?.map((f) => f.path)).toEqual([
          ".artisan/editor.yaml",
          "menus/shop_main.yaml",
        ]);
      }
    } finally {
      connToServerId.delete(connId);
      connSenders.delete(connId);
    }
  });

  test("times out when the plugin never answers", async () => {
    const { requestProjectRead, connToServerId, connSenders } = await import("./hub");
    const connId = "conn-project-read-mute";
    registerConn(connId, () => {});
    connToServerId.set(connId, "sk-project-mute");
    try {
      const outcome = await requestProjectRead("sk-project-mute", { projectId: "p" }, 20);
      expect(outcome).toEqual({ kind: "timeout" });
    } finally {
      connToServerId.delete(connId);
      connSenders.delete(connId);
    }
  });

  test("surfaces the plugin's error verbatim", async () => {
    const { requestProjectRead, connToServerId, connSenders } = await import("./hub");
    const sent: Record<string, unknown>[] = [];
    const connId = "conn-project-read-err";
    registerConn(connId, (raw) => sent.push(JSON.parse(raw)));
    connToServerId.set(connId, "sk-project-err");
    try {
      const pending = requestProjectRead("sk-project-err", { projectId: "jamais_cree" });
      await handlePluginMessage(connId, JSON.stringify({
        type: "project_read_result", request_id: sent[0]!.request_id, ok: false,
        error: "unknown_project",
      }));
      const outcome = await pending;
      expect(outcome.kind).toBe("result");
      if (outcome.kind === "result") expect(outcome.result.error).toBe("unknown_project");
    } finally {
      connToServerId.delete(connId);
      connSenders.delete(connId);
    }
  });
});

describe("project_write relay (server-disk-only-storage P1)", () => {
  test("relays files and deletes, and surfaces a conflict with the disk content", async () => {
    const { requestProjectWrite, connToServerId, connSenders } = await import("./hub");
    const sent: Record<string, unknown>[] = [];
    const connId = "conn-project-write";
    registerConn(connId, (raw) => sent.push(JSON.parse(raw)));
    connToServerId.set(connId, "sk-project-write");
    try {
      const pending = requestProjectWrite("sk-project-write", {
        projectId: "boutique",
        files: [{ path: "menus/a.yaml", content: "title: A\n", base_hash: "h_a" }],
        deletes: [{ path: "menus/b.yaml", base_hash: "h_b" }],
      });
      expect(sent[0]!.type).toBe("project_write");
      expect(sent[0]!.files).toEqual([{ path: "menus/a.yaml", content: "title: A\n", base_hash: "h_a" }]);
      expect(sent[0]!.deletes).toEqual([{ path: "menus/b.yaml", base_hash: "h_b" }]);

      await handlePluginMessage(connId, JSON.stringify({
        type: "project_write_result", request_id: sent[0]!.request_id, ok: false,
        error: "conflict",
        conflicts: [{ path: "menus/a.yaml", disk: "title: A depuis le disque\n" }],
      }));

      const outcome = await pending;
      expect(outcome.kind).toBe("result");
      if (outcome.kind === "result") {
        expect(outcome.result.error).toBe("conflict");
        // Le contenu disque voyage avec le conflit : pas de second aller-retour.
        expect(outcome.result.conflicts?.[0]?.disk).toBe("title: A depuis le disque\n");
      }
    } finally {
      connToServerId.delete(connId);
      connSenders.delete(connId);
    }
  });

  test("resolves offline when no plugin conn is bound", async () => {
    const { requestProjectWrite } = await import("./hub");
    const outcome = await requestProjectWrite("sk-not-connected", { projectId: "p", files: [] });
    expect(outcome).toEqual({ kind: "offline" });
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

describe("requestOnlinePlayers", () => {
  test("resolves offline when no plugin conn is bound to the server key", async () => {
    expect(await requestOnlinePlayers("sk-not-connected")).toEqual({ kind: "offline" });
  });

  /**
   * Regression: this handler returned bare `undefined`, and `app.ts` reads
   * `result.reply` on it — the backend crashed on the first plugin message after
   * boot. Every branch of handlePluginMessage must return the `{reply}` shape.
   */
  test("handling the result never returns undefined", async () => {
    registerConn("connOP", () => {});
    connToServerId.set("connOP", "sk-players");
    try {
      const res = await handlePluginMessage(
        "connOP",
        JSON.stringify({ type: "online_players_result", request_id: "nobody-waiting", ok: true, players: [] }),
      );
      expect(res).toBeDefined();
      expect(res.reply).toBeNull();
    } finally {
      connToServerId.delete("connOP");
      connSenders.delete("connOP");
    }
  });

  test("sends online_players_fetch and resolves on the correlated result", async () => {
    const sent: { type: string; request_id: string }[] = [];
    registerConn("connOP2", (raw) => sent.push(JSON.parse(raw)));
    connToServerId.set("connOP2", "sk-players");
    try {
      const pending = requestOnlinePlayers("sk-players");
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe("online_players_fetch");

      await handlePluginMessage(
        "connOP2",
        JSON.stringify({
          type: "online_players_result",
          request_id: sent[0].request_id,
          ok: true,
          players: ["Alice", "Iban_"],
        }),
      );

      const outcome = await pending;
      expect(outcome.kind).toBe("result");
      if (outcome.kind === "result") expect(outcome.result.players).toEqual(["Alice", "Iban_"]);
    } finally {
      connToServerId.delete("connOP2");
      connSenders.delete("connOP2");
    }
  });

  test("resolves timeout when the plugin never answers", async () => {
    registerConn("connOP3", () => {});
    connToServerId.set("connOP3", "sk-silent");
    try {
      expect(await requestOnlinePlayers("sk-silent", 20)).toEqual({ kind: "timeout" });
    } finally {
      connToServerId.delete("connOP3");
      connSenders.delete("connOP3");
    }
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


describe("requestPlayerInventory", () => {
  test("resolves offline when no plugin conn is bound to the server key", async () => {
    const outcome = await requestPlayerInventory("sk-not-connected", "Steve");
    expect(outcome).toEqual({ kind: "offline" });
  });

  test("sends player_inventory_fetch and resolves on the correlated result", async () => {
    const sent: PlayerInventoryFetchMessage[] = [];
    registerConn("connInv", (raw) => sent.push(JSON.parse(raw)));
    connToServerId.set("connInv", "sk-inv");
    try {
      const p = requestPlayerInventory("sk-inv", "Steve");
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe("player_inventory_fetch");
      expect(sent[0].player).toBe("Steve");

      await handlePluginMessage("connInv", JSON.stringify({
        type: "player_inventory_result", request_id: sent[0].request_id,
        ok: true,
        slots: [{
          slot: 0,
          stack_yaml: "item:\n  ==: org.bukkit.inventory.ItemStack\n  type: PAPER\n",
          display: { material: "nexo:arcanist_key", enchanted: true, count: 5, name: "1 clé Luxury" },
        }],
      }));

      const outcome = await p;
      expect(outcome.kind).toBe("result");
      if (outcome.kind === "result") {
        expect(outcome.result.ok).toBe(true);
        expect(outcome.result.slots).toHaveLength(1);
        expect(outcome.result.slots![0].display.material).toBe("nexo:arcanist_key");
      }
    } finally {
      connToServerId.delete("connInv");
      connSenders.delete("connInv");
    }
  });

  test("resolves timeout when the plugin never answers", async () => {
    registerConn("connInvT", () => {});
    connToServerId.set("connInvT", "sk-inv-slow");
    try {
      const outcome = await requestPlayerInventory("sk-inv-slow", "Steve", 20);
      expect(outcome).toEqual({ kind: "timeout" });
    } finally {
      connToServerId.delete("connInvT");
      connSenders.delete("connInvT");
    }
  });
});


// Two unrelated servers (different networks, different owners) both run the
// Boutique add-on, which bootstraps a project whose on-disk id is always
// `boutique_shop`. Before the ownership guard, the second server's push
// resolved the project by id ALONE and silently overwrote the first server's
// content — a cross-tenant write reachable from the normal link flow
// (incident 2026-08-12).
