import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { app } from "../../app";
import { __setProviderForTests } from "./routes";
import type { LlmProvider, LlmStreamEvent } from "./provider/types";
import { db } from "../../db/index";
import { editorSessions, serverKeys, networks } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { eq } from "drizzle-orm";

const validMenu = { schema: "menu/v1", id: "shop", title: [{ kind: "plain", value: { key: "k" } }], size: 27, layers: [{ id: "l1", name: "d", elements: [{ id: "e1", positions: "0", appearances: [{ material: "STONE" }] }] }] };

const scripted: LlmStreamEvent[][] = [
  [{ type: "tool_use", id: "c1", name: "upsert_menu", input: { menu: validMenu } }, { type: "done", stopReason: "tool_calls" }],
  [{ type: "text", text: "Created the shop." }, { type: "done", stopReason: "end_turn" }],
];
function fakeProvider(): LlmProvider {
  let i = 0;
  return { async *streamTurn() { const t = scripted[i++] ?? [{ type: "done", stopReason: "end_turn" }]; for (const e of t) yield e; } };
}

// Minimal valid session in the test DB so validateAccessToken accepts the token.
// serverKeys requires: id, hash, networkId (FK→networks), createdAt.
// editorSessions requires: token (PK), serverKeyId (FK), createdBy, createdAt,
// expiresAt; plus accessToken + accessExpiresAt(future) and no revokedAt for
// validateAccessToken to succeed.
const SRV = "srv_test_assistant";
const ACCESS = "acc_test_assistant_token";
const URL_TOKEN = "url_test_assistant";
let networkId = "";

beforeAll(async () => {
  const network = await createNetwork("assistant-test-network");
  networkId = network.id;
  await db.insert(serverKeys).values({
    id: SRV,
    hash: "h_test_assistant",
    label: "assistant-test",
    networkId,
    createdAt: new Date(),
  }).onConflictDoNothing();
  const future = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(editorSessions).values({
    token: URL_TOKEN,
    serverKeyId: SRV,
    createdBy: "CONSOLE",
    createdAt: new Date(),
    expiresAt: future,
    accessToken: ACCESS,
    accessExpiresAt: future,
  }).onConflictDoNothing();
  __setProviderForTests(fakeProvider());
});

afterAll(async () => {
  __setProviderForTests(null);
  await db.delete(editorSessions).where(eq(editorSessions.token, URL_TOKEN));
  await db.delete(serverKeys).where(eq(serverKeys.id, SRV));
  if (networkId) await db.delete(networks).where(eq(networks.id, networkId));
});

const auth = { Authorization: `Bearer ${ACCESS}`, "Content-Type": "application/json" };

describe("assistant routes", () => {
  it("401 without a valid token", async () => {
    const res = await app.request("/api/v1/assistant/conversations", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(401);
  });

  it("creates a conversation and streams engine events for a message", async () => {
    const created = await app.request("/api/v1/assistant/conversations", { method: "POST", headers: auth, body: JSON.stringify({ menus: [], attachments: {} }) });
    expect(created.status).toBe(200);
    const { conversationId } = await created.json();
    expect(typeof conversationId).toBe("string");

    const res = await app.request(`/api/v1/assistant/conversations/${conversationId}/messages`, { method: "POST", headers: auth, body: JSON.stringify({ text: "make a shop" }) });
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain("event: menu_written");
    expect(sse).toContain("event: done");
  });
});
