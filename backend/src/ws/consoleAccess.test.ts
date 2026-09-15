import { afterEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { networks, serverKeys, users } from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { createNetwork } from "../lib/networkManager";
import { getRole } from "../lib/membershipGuard";
import { addMembership } from "../lib/membershipManager";
import { createSession } from "../lib/sessionManager";
import { app } from "../app";
import { cleanupConn, handlePluginMessage, registerConn } from "./hub";

const connections: string[] = [];
const networkIds: string[] = [];
const userIds: string[] = [];
afterEach(async () => {
  connections.splice(0).forEach(cleanupConn);
  for (const id of networkIds.splice(0)) await db.delete(networks).where(eq(networks.id, id));
  for (const id of userIds.splice(0)) await db.delete(users).where(eq(users.id, id));
});

async function fixture(mode = "console") {
  const network = await createNetwork("Console access");
  networkIds.push(network.id);
  const key = await generateServerKey();
  await db.insert(serverKeys).values({ id: key.id, hash: key.hash, networkId: network.id, createdAt: new Date() });
  const id = crypto.randomUUID();
  userIds.push(id);
  const email = `${id}@example.com`;
  await db.insert(users).values({ id, email, name: "New member", createdAt: new Date(), updatedAt: new Date() });
  const conn = crypto.randomUUID();
  connections.push(conn);
  registerConn(conn, () => {});
  const hello = { type: "hello", server_key: key.key, plugin_version: "1", minecraft_version: "1.21.4", current_bundle_hash: "", editor_access_mode: mode };
  await handlePluginMessage(conn, JSON.stringify(hello));
  return { network, key, id, email, conn, hello };
}

test("console adds an existing account as a member of its own network", async () => {
  const f = await fixture();
  const result = await handlePluginMessage(f.conn, JSON.stringify({ type: "member_add", request_id: "request-1", email: f.email.toUpperCase() }));
  expect(JSON.parse(result.reply!)).toMatchObject({ type: "member_add_result", request_id: "request-1", ok: true });
  expect(await getRole(f.id, f.network.id)).toBe("member");
});

test("access page reports console instructions for the signed-in account, even offline", async () => {
  const f = await fixture();
  const session = await createSession(f.id);
  cleanupConn(f.conn);
  const response = await app.request(`/api/v1/networks/${f.network.id}/access-options`, { headers: { Cookie: `artisan_user_session=${session.id}` } });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ mode: "console", isMember: false, command: `artisan member add ${f.email}`, servers: [{ id: f.key.id, online: false }] });
});

test("invitation mode, unauthenticated and replaced connections cannot add members", async () => {
  const f = await fixture("invitation");
  const message = JSON.stringify({ type: "member_add", request_id: "r", email: f.email });
  expect(JSON.parse((await handlePluginMessage(f.conn, message)).reply!)).toMatchObject({ ok: false, error: "console_disabled" });
  expect(JSON.parse((await handlePluginMessage("unknown", message)).reply!)).toMatchObject({ ok: false, error: "unauthorized" });
  cleanupConn(f.conn);
  expect(JSON.parse((await handlePluginMessage(f.conn, message)).reply!)).toMatchObject({ ok: false });
  expect(await getRole(f.id, f.network.id)).toBeNull();
});

test("retry preserves existing roles and does not create accounts", async () => {
  const f = await fixture();
  await addMembership(f.id, f.network.id, "owner");
  const add = (email: unknown) => handlePluginMessage(f.conn, JSON.stringify({ type: "member_add", request_id: "r", email }));
  expect(JSON.parse((await add(f.email)).reply!)).toMatchObject({ ok: true, already_member: true });
  expect(await getRole(f.id, f.network.id)).toBe("owner");
  expect(JSON.parse((await add("missing@example.com")).reply!)).toMatchObject({ ok: false, error: "account_not_found" });
  expect(JSON.parse((await add({ email: f.email })).reply!)).toMatchObject({ ok: false, error: "invalid_email" });
});

test("console mode replaces access requests and legacy hello restores invitation mode", async () => {
  const f = await fixture();
  const session = await createSession(f.id);
  const headers = { Cookie: `artisan_user_session=${session.id}` };
  const url = `/api/v1/networks/${f.network.id}`;
  expect((await app.request(`${url}/access-options`)).status).toBe(401);
  const request = await app.request(`${url}/access-requests`, { method: "POST", headers });
  expect(request.status).toBe(409);
  expect(await request.json()).toMatchObject({ error: "console_required" });
  await handlePluginMessage(f.conn, JSON.stringify({ ...f.hello, editor_access_mode: undefined }));
  const options = await app.request(`${url}/access-options`, { headers });
  expect(await options.json()).toMatchObject({ mode: "invitation", command: null, servers: [] });
  expect((await app.request(`${url}/access-requests`, { method: "POST", headers })).status).toBe(201);
});
