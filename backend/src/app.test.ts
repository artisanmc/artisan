import { describe, expect, test } from "bun:test";
import { app } from "./app";

describe("GET /health", () => {
  test("returns 200 with ok: true", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
