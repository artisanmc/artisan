import { beforeEach, describe, expect, test } from "bun:test";
import { app } from "../app";
import { db } from "../db/index";
import {linkCodes, serverKeys, networks, projects} from "../db/schema";

async function clearAll() {
  await db.delete(projects);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(networks);
}

describe("server keys API", () => {
  beforeEach(clearAll);
  test("POST /api/v1/server-keys returns a sk_ key", async () => {
    const res = await app.request("/api/v1/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "my-server" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { key: string; id: string };
    expect(body.key).toMatch(/^sk_[0-9a-f]{64}$/);
    expect(body.id).toBeDefined();
  });

  test("GET /api/v1/server-keys lists keys with masked prefix", async () => {
    await app.request("/api/v1/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "list-test" }),
    });
    const res = await app.request("/api/v1/server-keys");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; keyPrefix: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].keyPrefix).toMatch(/^[0-9a-f]{8}\.\.\.$/);
  });
});
