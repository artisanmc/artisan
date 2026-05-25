import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { menusModule } from "./index";

describe("menusModule", () => {
  it("has id 'menus' and schema 'menu/v1'", () => {
    expect(menusModule.id).toBe("menus");
    expect(menusModule.schemaVersion).toBe("menu/v1");
  });

  it("registers /api/v1/modules/menus/health on the app", async () => {
    const app = new Hono();
    menusModule.registerRoutes(app);
    const res = await app.request("/api/v1/modules/menus/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.module).toBe("menus");
  });
});
