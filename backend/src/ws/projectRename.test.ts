import { beforeEach, expect, test } from "bun:test";
import { db } from "../db";
import { networks, projects, serverKeys } from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { beginProjectRename, pendingProjectRenames } from "../lib/projectRename";
import { getProject } from "../lib/projectStorage";
import { connSenders, connToServerId, handlePluginMessage, registerConn, requestProjectList, requestProjectRename, requestProjectWrite } from "./hub";

let key: string;
let serverId: string;
beforeEach(async () => {
  connSenders.clear(); connToServerId.clear();
  await db.delete(networks);
  const now = new Date();
  await db.insert(networks).values({ id: "rename-net", name: "Rename", createdAt: now, updatedAt: now });
  const generated = await generateServerKey(); key = generated.key; serverId = generated.id;
  await db.insert(serverKeys).values({ id: serverId, hash: generated.hash, networkId: "rename-net", createdAt: now });
  await db.insert(projects).values({ id: "anchor", externalId: "old", identityKind: "folder", name: "Project", networkId: "rename-net", serverKeyId: serverId, createdAt: now, updatedAt: now });
});

test("reconnect applies exact durable receipt before discovery creates a target anchor", async () => {
  await beginProjectRename("anchor", "lost-ack", "new");
  registerConn("reconnect", () => {});
  await handlePluginMessage("reconnect", JSON.stringify({ type: "hello", content_version: 2, server_key: key, plugin_version: "test", minecraft_version: "1.21.4", current_bundle_hash: "", local_project_ids: ["new"], capabilities: ["project_rename"], project_roots: [{ project_id: "new", identity: "folder" }], project_rename_results: [{ operation_id: "lost-ack", project_id: "old", target_project_id: "new" }] }));
  expect((await getProject("anchor"))?.externalId).toBe("new");
  expect((await db.select().from(projects)).map((p) => p.id)).toEqual(["anchor"]);
});

test("listing retries pending rename and writes stay locked until terminal result", async () => {
  await beginProjectRename("anchor", "retry", "new");
  const messages: string[] = [];
  let acknowledgement: Promise<unknown> = Promise.resolve();
  registerConn("server", (raw) => {
    const msg = JSON.parse(raw); messages.push(msg.type);
    if (msg.type === "project_rename") acknowledgement = handlePluginMessage("server", JSON.stringify({ ...msg, type: "project_rename_result", ok: true }));
    if (msg.type === "project_list") void handlePluginMessage("server", JSON.stringify({ type: "project_list_result", request_id: msg.request_id, ok: true, project_ids: ["new"] }));
  });
  connToServerId.set("server", serverId);
  expect(await requestProjectWrite(serverId, { projectId: "old", files: [] })).toMatchObject({ result: { ok: false, message: "rename_in_progress" } });
  expect(await requestProjectList(serverId)).toMatchObject({ kind: "result" });
  await acknowledgement;
  expect(messages).toEqual(["project_rename", "project_list"]);
  expect(await pendingProjectRenames(serverId)).toEqual([]);
  expect(await requestProjectList(serverId)).toMatchObject({ kind: "result", result: { project_ids: ["new"] } });
});

test("wrong server cannot acknowledge operation and terminal add-on rejection releases reservation", async () => {
  await beginProjectRename("anchor", "denied", "new");
  registerConn("other", () => {}); connToServerId.set("other", "wrong-server");
  registerConn("server", (raw) => {
    const msg = JSON.parse(raw);
    void (async () => {
      await handlePluginMessage("other", JSON.stringify({ ...msg, type: "project_rename_result", ok: true }));
      expect((await getProject("anchor"))?.externalId).toBe("old");
      await handlePluginMessage("server", JSON.stringify({ ...msg, type: "project_rename_result", ok: false, error: "addon_owned" }));
    })();
  });
  connToServerId.set("server", serverId);
  expect(await requestProjectRename(serverId, { operationId: "denied", projectId: "old", targetId: "new" })).toMatchObject({ result: { error: "addon_owned" } });
  expect(await pendingProjectRenames(serverId)).toEqual([]);
});

test("ambiguous disk failure isolates reserved roots while unrelated projects remain visible", async () => {
  await beginProjectRename("anchor", "uncertain", "new");
  const messages: string[] = [];
  registerConn("uncertain-server", (raw) => {
    const msg = JSON.parse(raw); messages.push(msg.type);
    if (msg.type === "project_rename") void handlePluginMessage("uncertain-server", JSON.stringify({ ...msg, type: "project_rename_result", ok: false, error: "rename_error" }));
    if (msg.type === "project_list") void handlePluginMessage("uncertain-server", JSON.stringify({ type: "project_list_result", request_id: msg.request_id, ok: true, project_ids: ["old", "new", "unrelated"] }));
  });
  connToServerId.set("uncertain-server", serverId);
  expect(await requestProjectList(serverId)).toMatchObject({ kind: "result", result: { project_ids: ["unrelated"], pending_renames: [{ operation_id: "uncertain", project_id: "old", target_project_id: "new" }] } });
  expect(messages).toEqual(["project_rename", "project_list"]);
  expect(await pendingProjectRenames(serverId)).toHaveLength(1);
});
