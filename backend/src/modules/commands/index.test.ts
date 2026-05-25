import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { commandsModule } from "./index";

describe("commandsModule", () => {
  it("has id 'commands' and schema 'command/v1'", () => {
    expect(commandsModule.id).toBe("commands");
    expect(commandsModule.schemaVersion).toBe("command/v1");
  });

  it("registers /api/v1/modules/commands/health on the app", async () => {
    const app = new Hono();
    commandsModule.registerRoutes(app);
    const res = await app.request("/api/v1/modules/commands/health");
    expect(res.status).toBe(200);
  });
});
