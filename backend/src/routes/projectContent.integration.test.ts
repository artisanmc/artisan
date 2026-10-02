import { beforeEach, expect, test } from "bun:test";
import { app } from "../app";
import { db } from "../db";
import { networks, projects, serverKeys, users } from "../db/schema";
import { createSession } from "../lib/sessionManager";
import { generateServerKey } from "../lib/auth";
import { getProject } from "../lib/projectStorage";
import { addMembership } from "../lib/membershipManager";
import { connSenders, connToServerId, handlePluginMessage, registerConn } from "../ws/hub";

beforeEach(async () => {
  await db.delete(networks);
  await db.delete(users);
});

test("authenticated rename uses immutable anchor, exposes folder capability and retains slug", async () => {
  const now = new Date();
  await db.insert(users).values({ id: "rename-user", email: "rename-user@test.invalid", name: "Owner", createdAt: now, updatedAt: now });
  await db.insert(networks).values({ id: "rename-network", name: "Rename", createdAt: now, updatedAt: now });
  await addMembership("rename-user", "rename-network", "owner");
  const generated = await generateServerKey();
  await db.insert(serverKeys).values({ id: generated.id, hash: generated.hash, networkId: "rename-network", createdAt: now });
  await db.insert(projects).values({ id: "rename-anchor", externalId: "old", slug: "stable-url", name: "Display name", networkId: "rename-network", serverKeyId: generated.id, createdAt: now, updatedAt: now });
  const session = await createSession("rename-user");
  const headers = { Cookie: `artisan_user_session=${session.id}`, "Content-Type": "application/json" };
  let throwOnRename = false;
  const diskIds = ["old"];
  registerConn("rename-route", (raw) => {
    const message = JSON.parse(raw);
    if (message.type === "project_rename" && throwOnRename) throw new Error("socket closed during send");
    if (message.type === "project_rename") void handlePluginMessage("rename-route", JSON.stringify({ ...message, type: "project_rename_result", ok: true }));
    if (message.type === "project_list") void handlePluginMessage("rename-route", JSON.stringify({ type: "project_list_result", request_id: message.request_id, ok: true, project_ids: diskIds, project_roots: diskIds.map((project_id) => ({ project_id, identity: "folder" })) }));
  });
  try {
    await handlePluginMessage("rename-route", JSON.stringify({ type: "hello", content_version: 2, server_key: generated.key, plugin_version: "test", minecraft_version: "1.21.4", current_bundle_hash: "", capabilities: ["project_rename"], project_roots: [{ project_id: "old", identity: "folder" }] }));
    diskIds.push("late");
    const direct = await app.request(`/api/v1/user/projects/late?server=${generated.id}`, { headers });
    expect(direct.status).toBe(200);
    const directProject = (await direct.json()).project;
    const capabilities = await app.request(`/api/v1/projects/${directProject.id}/capabilities`, { headers });
    expect((await capabilities.json()).canRename).toBe(true);
    const list = await app.request(`/api/v1/networks/rename-network/servers/${generated.id}/projects`, { headers });
    expect((await list.json()).projects[0]).toMatchObject({ id: "rename-anchor", externalId: "old", capabilities: { canRename: true } });
    const response = await app.request("/api/v1/projects/rename-anchor/rename", { method: "POST", headers, body: JSON.stringify({ operationId: "route-operation", targetId: "new" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, projectId: "rename-anchor", diskId: "new" });
    diskIds.splice(0, 1, "new");
    expect(await getProject("rename-anchor")).toMatchObject({ externalId: "new", slug: "stable-url" });
    const retry = await app.request("/api/v1/projects/rename-anchor/rename", { method: "POST", headers, body: JSON.stringify({ operationId: "route-operation", targetId: "new" }) });
    expect(retry.status).toBe(200);
    throwOnRename = true;
    const failedSend = await app.request("/api/v1/projects/rename-anchor/rename", { method: "POST", headers, body: JSON.stringify({ operationId: "pending-offline", targetId: "next" }) });
    expect(failedSend.status).toBe(202);
    expect(await failedSend.json()).toMatchObject({ operationId: "pending-offline", error: "rename_pending" });
    const pendingListing = await app.request(`/api/v1/networks/rename-network/servers/${generated.id}/projects`, { headers });
    const pendingBody = await pendingListing.json();
    expect(pendingBody.project_ids).toEqual(["late"]);
    expect(pendingBody.projects).toHaveLength(2);
    expect(pendingBody.projects.find((project: { id: string }) => project.id === "rename-anchor")).toMatchObject({
      id: "rename-anchor", externalId: "new", capabilities: { canRename: false },
      pendingRename: { operationId: "pending-offline", targetId: "next", status: "pending" },
    });
    connSenders.delete("rename-route"); connToServerId.delete("rename-route");
    const offlineRetry = await app.request("/api/v1/projects/rename-anchor/rename", { method: "POST", headers, body: JSON.stringify({ operationId: "route-operation", targetId: "new" }) });
    expect(offlineRetry.status).toBe(200);
    const offlinePending = await app.request("/api/v1/projects/rename-anchor/rename", { method: "POST", headers, body: JSON.stringify({ operationId: "pending-offline", targetId: "next" }) });
    expect(offlinePending.status).toBe(202);
    expect(await offlinePending.json()).toMatchObject({ operationId: "pending-offline", error: "rename_pending" });
    const deletion = await app.request("/api/v1/user/projects/rename-anchor", { method: "DELETE", headers });
    expect(deletion.status).toBe(409);
    expect(await deletion.json()).toEqual({ error: "rename_in_progress" });
  } finally { connSenders.delete("rename-route"); connToServerId.delete("rename-route"); }
});

test("app mounted internal-ID route authenticates and denies cross-network reads before storage access", async () => {
  const now = new Date();
  await db.insert(users).values(["owner", "outsider"].map((id) => ({ id, email: `${id}@content.test`, name: id, createdAt: now, updatedAt: now })));
  await db.insert(networks).values(["owned", "other"].map((id) => ({ id, name: id, createdAt: now, updatedAt: now })));
  await addMembership("owner", "owned", "owner");
  await addMembership("outsider", "other", "owner");
  await db.insert(serverKeys).values({ id: "content-server", hash: "content-server-hash", networkId: "owned", createdAt: now });
  await db.insert(projects).values({ id: "internal-content-id", externalId: "folder-name", name: "Project", networkId: "owned", serverKeyId: "content-server", createdAt: now, updatedAt: now });
  const owner = await createSession("owner");
  const outsider = await createSession("outsider");
  const requests: string[] = [];
  registerConn("content-connection", (raw) => {
    const message = JSON.parse(raw);
    if (message.type !== "project_read") return;
    requests.push(message.project_id);
    void handlePluginMessage("content-connection", JSON.stringify({ type: "project_read_result", request_id: message.request_id, ok: true, files: [{ path: "manifest.yaml", content: "name: Project" }], hash: "live" }));
  });
  connToServerId.set("content-connection", "content-server");
  const url = "/api/v1/projects/internal-content-id/files?storageKind=hosted&serverId=other";
  try {
    expect((await app.request(url)).status).toBe(401);
    expect((await app.request(url, { headers: { Cookie: `artisan_user_session=${outsider.id}` } })).status).toBe(403);
    expect(requests).toEqual([]);
    const response = await app.request(url, { headers: { Cookie: `artisan_user_session=${owner.id}` } });
    expect(response.status).toBe(200);
    expect((await response.json()).files).toEqual([{ path: "manifest.yaml", content: "name: Project" }]);
    expect(requests).toEqual(["folder-name"]);
  } finally {
    connSenders.delete("content-connection");
    connToServerId.delete("content-connection");
  }
});
