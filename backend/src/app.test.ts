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

describe("module registry", () => {
  test("mounts /api/v1/modules/menus/health", async () => {
    const res = await app.request("/api/v1/modules/menus/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { module: string };
    expect(body.module).toBe("menus");
  });

  test("mounts /api/v1/modules/commands/health", async () => {
    const res = await app.request("/api/v1/modules/commands/health");
    expect(res.status).toBe(200);
  });
});
