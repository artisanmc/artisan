import { Hono } from "hono";
import type { BackendModule } from "../api/types";

function buildCommandsSubrouter(): Hono {
  const sub = new Hono();
  sub.get("/health", (c) => c.json({ module: "commands", schema: "command/v1" }));
  return sub;
}

export const commandsModule: BackendModule = {
  id: "commands",
  schemaVersion: "command/v1",
  registerRoutes: (app) => {
    app.route("/api/v1/modules/commands", buildCommandsSubrouter());
  },
};
