import { afterEach, beforeEach, expect, test } from "bun:test";
import { db } from "../db";
import { appSettings, networkBilling, networks, serverKeys, subscriptionPlans } from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { registerConn, cleanupConn, handlePluginMessage, requestProjectWrite, requestAssetWrite, requestConfigWrite, requestProjectDraft, connToServerId } from "./hub";
import { setSetting } from "../lib/appSettings";

const connections: string[] = [];
const now = new Date();
beforeEach(async () => {
  await db.delete(networkBilling);
  await db.delete(subscriptionPlans);
  await db.delete(networks);
  await db.delete(appSettings);
  await db.insert(networks).values({ id: "quota", name: "Quota", createdAt: now, updatedAt: now });
  await setSetting("editor_commercial_policy", { quota: 10, enforcementEnabled: false }, null);
});
afterEach(async () => {
  connections.splice(0).forEach(cleanupConn);
  await db.delete(networkBilling);
  await db.delete(subscriptionPlans);
  await db.delete(appSettings);
});

async function setup(quota: number | null, capabilities: string[]) {
  const { id, key, hash } = await generateServerKey();
  await db.insert(serverKeys).values({ id, hash, networkId: "quota", createdAt: now });
  await db.insert(subscriptionPlans).values({ id: "quota-plan", key: "quota-plan", name: "Contract", priceCents: 1, creditsPerPeriod: 0,
    publicationStatus: "published", targetNetworkId: "quota", limits: { resourcesPerServer: quota, servers: 1, collaborators: 1 }, capabilities: { editorPro: true }, createdAt: now, updatedAt: now });
  await db.insert(networkBilling).values({ networkId: "quota", planId: "quota-plan", paidEditorPro: true, currentPeriodId: "paid", paidThrough: new Date("2999-01-01"), createdAt: now, updatedAt: now });
  const sent: any[] = [];
  const hello = { type: "hello", content_version: 2, server_key: key, plugin_version: "1", minecraft_version: "1.21.4", current_bundle_hash: "" };
  async function connect(conn: string, caps: string[]) {
    connections.push(conn);
    registerConn(conn, raw => {
      const msg = JSON.parse(raw);
      if (msg.type === "project_write") {
        sent.push(msg);
        void handlePluginMessage(conn, JSON.stringify({ type: "project_write_result", request_id: msg.request_id, ok: true }));
      }
    });
    await handlePluginMessage(conn, JSON.stringify({ ...hello, capabilities: caps }));
  }
  await connect("quota-first", capabilities);
  return { id, sent, connect };
}

test("finite custom quota reaches v1 without the Pro override", async () => {
  const { id, sent } = await setup(17, ["resource_quota_v1"]);
  expect(await requestProjectWrite(id, { projectId: "p", files: [] })).toMatchObject({ result: { ok: true } });
  expect(sent[0].commercial_policy).toEqual({ enabled: true, quota: 17, pro_until: null });
});

test("Free is enforced without billing and legacy plugins cannot bypass it", async () => {
  const { id, sent, connect } = await setup(17, []);
  await db.delete(networkBilling);
  expect(await requestProjectWrite(id, { projectId: "p", files: [] })).toMatchObject({ result: { error: "plugin_update_required" } });
  expect(sent).toHaveLength(0);
  cleanupConn("quota-first");
  await connect("quota-free", ["resource_quota_v1"]);
  expect(await requestProjectWrite(id, { projectId: "p", files: [] })).toMatchObject({ result: { ok: true } });
  expect(sent[0].commercial_policy).toEqual({ enabled: true, quota: 10, pro_until: null });
});

test("unlimited quota requires v2 on every active sender", async () => {
  const { id, sent, connect } = await setup(null, ["resource_quota_v1", "project_drafts_v1"]);
  expect(await requestProjectWrite(id, { projectId: "p", files: [] })).toMatchObject({ result: { ok: false, error: "plugin_update_required" } });
  expect(await requestAssetWrite(id, { projectId: "p", files: [] })).toMatchObject({ result: { error: "plugin_update_required" } });
  expect(await requestConfigWrite(id, { projectId: "p", files: [] })).toMatchObject({ result: { error: "plugin_update_required" } });
  expect(await requestProjectDraft(id, { action: "publish", project_id: "p", owner_id: "owner" })).toMatchObject({ result: { error: "plugin_update_required" } });
  expect(sent).toHaveLength(0);
  await connect("quota-second", ["resource_quota_v2"]);
  registerConn("quota-stale", () => { throw new Error("unsupported sender must not receive the write"); });
  connections.push("quota-stale");
  connToServerId.set("quota-stale", id);
  expect(await requestProjectWrite(id, { projectId: "p", files: [] })).toMatchObject({ result: { error: "plugin_update_required" } });
  cleanupConn("quota-stale");
  cleanupConn("quota-first");
  expect(await requestProjectWrite(id, { projectId: "p", files: [] })).toMatchObject({ result: { ok: true } });
  expect(sent[0].commercial_policy).toEqual({ enabled: true, quota: null, pro_until: null });
});
