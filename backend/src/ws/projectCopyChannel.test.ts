import { afterEach, expect, test } from "bun:test";
import { db } from "../db";
import { networks, serverKeys, projectCopies, projects } from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { connToServerId, cleanupConn, handlePluginMessage, registerConn, requestProjectCopy, projectCopyTarget, requestProjectList } from "./hub";

afterEach(() => { cleanupConn("copy-channel"); cleanupConn("copy-attacker"); });
test("copy replies require exact connection, operation, folder and fingerprint; disconnect settles pending request", async () => {
  await db.delete(networks);
  const now = new Date();
  await db.insert(networks).values({ id: "copy-wire", name: "N", createdAt: now, updatedAt: now });
  const key = await generateServerKey();
  await db.insert(serverKeys).values({ id: key.id, hash: key.hash, networkId: "copy-wire", createdAt: now });
  const messages: any[] = [];
  registerConn("copy-channel", raw => messages.push(JSON.parse(raw)));
  await handlePluginMessage("copy-channel", JSON.stringify({ type: "hello", server_key: key.key, plugin_version: "test", minecraft_version: "1.21.4", current_bundle_hash: "", local_project_ids: [], capabilities: ["project_copy_v1"], installed_modules: [{ id: "menus", version: "1" }] }));
  expect(projectCopyTarget(key.id)).toEqual({ minecraftVersion: "1.21.4", modules: ["menus"] });
  const promise = requestProjectCopy(key.id, { operation_id: "op", target_id: "folder", fingerprint: "digest", action: "status" }, 1000);
  const request = messages.find(m => m.type === "project_copy");
  let settled = false; void promise.then(() => { settled = true; });
  const response = { ...request, type: "project_copy_result", ok: true, state: "missing" };
  connToServerId.set("copy-attacker", "other-server");
  await handlePluginMessage("copy-attacker", JSON.stringify(response));
  await handlePluginMessage("copy-channel", JSON.stringify({ ...response, fingerprint: "different" }));
  await handlePluginMessage("copy-channel", JSON.stringify({ ...response, operation_id: "other" }));
  expect(settled).toBe(false);
  await handlePluginMessage("copy-channel", JSON.stringify(response));
  expect(await promise).toMatchObject({ kind: "result", result: { ok: true, state: "missing" } });
  const interrupted = requestProjectCopy(key.id, { operation_id: "op", target_id: "folder", fingerprint: "digest", action: "status" });
  cleanupConn("copy-channel"); expect(await interrupted).toEqual({ kind: "offline" }); expect(projectCopyTarget(key.id)).toBeUndefined();
});

test("hello and project list cannot discover an activated folder before its verified copy receipt", async () => {
  await db.delete(networks);
  const now = new Date();
  await db.insert(networks).values({ id: "copy-wire", name: "N", createdAt: now, updatedAt: now });
  const key = await generateServerKey();
  await db.insert(serverKeys).values({ id: key.id, hash: key.hash, networkId: "copy-wire", createdAt: now });
  await db.insert(projectCopies).values({ id: "reserved", ownerId: "deleted", sourceProjectId: "deleted-source", sourceRevision: "saved", serverKeyId: key.id, targetNetworkId: "copy-wire", targetId: "reserved", minecraftVersion: "1.21.4", modules: [], fingerprint: "digest", manifest: [], artifact: [], status: "pending", createdAt: now, updatedAt: now });
  registerConn("copy-channel", raw => { const m = JSON.parse(raw); if (m.type === "project_list") void handlePluginMessage("copy-channel", JSON.stringify({ type: "project_list_result", request_id: m.request_id, ok: true, project_ids: ["reserved", "ordinary"], project_roots: [{ project_id: "reserved", identity: "folder" }] })); });
  await handlePluginMessage("copy-channel", JSON.stringify({ type: "hello", server_key: key.key, plugin_version: "test", minecraft_version: "1.21.4", current_bundle_hash: "", local_project_ids: ["reserved", "ordinary"], capabilities: [], project_roots: [{ project_id: "reserved", identity: "folder" }] }));
  expect((await db.select().from(projects)).map(p => p.externalId)).toEqual(["ordinary"]);
  expect(await requestProjectList(key.id)).toMatchObject({ result: { project_ids: ["ordinary"], project_roots: [] } });
});
