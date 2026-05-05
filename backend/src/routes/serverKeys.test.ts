import { describe, expect, test } from "bun:test";
import { app } from "../app";

describe("server keys API", () => {
  test("POST /api/server-keys returns a sk_ key", async () => {
    const res = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "my-server" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { key: string; id: string };
    expect(body.key).toMatch(/^sk_[0-9a-f]{64}$/);
    expect(body.id).toBeDefined();
  });

  test("GET /api/server-keys lists keys with masked prefix", async () => {
    await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "list-test" }),
    });
    const res = await app.request("/api/server-keys");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; keyPrefix: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].keyPrefix).toMatch(/^[0-9a-f]{8}\.\.\.$/);
  });
});
