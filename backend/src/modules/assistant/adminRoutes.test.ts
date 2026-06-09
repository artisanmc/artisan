import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { appSettings, users } from "../../db/schema";
import { createSession } from "../../lib/sessionManager";
import { __setTestProviderForTests } from "./adminRoutes";
import { ASSISTANT_SETTING_KEY } from "./provider/dbConfig";
import type { LlmProvider } from "./provider/types";

// Fake provider whose single turn yields a `done` event — so /test never hits
// the network.
function fakeProvider(): LlmProvider {
  return { async *streamTurn() { yield { type: "done", stopReason: "end_turn" }; } };
}

const ADMIN_ID = "user_admin_acfg";
const PLAIN_ID = "user_plain_acfg";
let adminSession = "";
let plainSession = "";

beforeAll(async () => {
  process.env.CONFIG_ENC_KEY = "0".repeat(64);
  const now = new Date();
  await db.insert(users).values({
    id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(users).values({
    id: PLAIN_ID, email: `${PLAIN_ID}@example.com`, name: "Plain", isAdmin: false, createdAt: now, updatedAt: now,
  }).onConflictDoNothing();
  adminSession = (await createSession(ADMIN_ID)).id;
  plainSession = (await createSession(PLAIN_ID)).id;
  __setTestProviderForTests(fakeProvider());
});

afterEach(async () => {
  await db.delete(appSettings).where(eq(appSettings.key, ASSISTANT_SETTING_KEY));
});

afterAll(async () => {
  __setTestProviderForTests(null);
  await db.delete(appSettings).where(eq(appSettings.key, ASSISTANT_SETTING_KEY));
  await db.delete(users).where(eq(users.id, ADMIN_ID));
  await db.delete(users).where(eq(users.id, PLAIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("assistant admin config endpoints", () => {
  it("403 for a request without an admin session", async () => {
    const res = await app.request("/api/v1/admin/assistant-config", { method: "GET" });
    expect(res.status).toBe(403);
  });

  it("403 for a non-admin user", async () => {
    const res = await app.request("/api/v1/admin/assistant-config", {
      method: "GET",
      headers: { Cookie: `artisan_user_session=${plainSession}` },
    });
    expect(res.status).toBe(403);
  });

  it("PUT encrypts+persists, then GET masks the key (keySet only)", async () => {
    const put = await app.request("/api/v1/admin/assistant-config", {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ provider: "deepseek", baseUrl: "", model: "deepseek-chat", apiKey: "sk-secret-123" }),
    });
    expect(put.status).toBe(200);
    const putBody = await put.json();
    expect(putBody).toEqual({ provider: "deepseek", baseUrl: "", model: "deepseek-chat", keySet: true });
    // The plaintext key must never be returned.
    expect(JSON.stringify(putBody)).not.toContain("sk-secret-123");

    const get = await app.request("/api/v1/admin/assistant-config", { method: "GET", headers: adminHeaders() });
    expect(get.status).toBe(200);
    const getBody = await get.json();
    expect(getBody.provider).toBe("deepseek");
    expect(getBody.model).toBe("deepseek-chat");
    expect(getBody.keySet).toBe(true);
    expect(JSON.stringify(getBody)).not.toContain("sk-secret-123");
    expect(getBody.apiKey).toBeUndefined();
    expect(getBody.apiKeyEncrypted).toBeUndefined();
  });

  it("PUT with empty apiKey preserves the previously stored key", async () => {
    await app.request("/api/v1/admin/assistant-config", {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ provider: "deepseek", model: "deepseek-chat", apiKey: "sk-first" }),
    });
    // Second PUT without a key (e.g. user only changed the model).
    const put = await app.request("/api/v1/admin/assistant-config", {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ provider: "deepseek", model: "deepseek-reasoner", apiKey: "" }),
    });
    const putBody = await put.json();
    expect(putBody.model).toBe("deepseek-reasoner");
    expect(putBody.keySet).toBe(true);

    const get = await app.request("/api/v1/admin/assistant-config", { method: "GET", headers: adminHeaders() });
    const getBody = await get.json();
    expect(getBody.keySet).toBe(true);
    expect(getBody.model).toBe("deepseek-reasoner");
  });

  it("POST /assistant-config/test returns { ok: true } with the fake provider", async () => {
    const res = await app.request("/api/v1/admin/assistant-config/test", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ provider: "deepseek", model: "deepseek-chat", apiKey: "sk-whatever" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});
