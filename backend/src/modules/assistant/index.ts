import type { Hono } from "hono";
import type { BackendModule } from "../api/types";
import { buildAssistantRouter } from "./routes";

export const assistantModule: BackendModule = {
  id: "assistant",
  schemaVersion: "menu/v1",
  registerRoutes: (app: Hono) => {
    app.route("/api/v1/assistant", buildAssistantRouter());
  },
};
