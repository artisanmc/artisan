import { Hono } from "hono";
import type { BackendModule } from "../api/types";

/**
 * V1 backend MenusModule — owns the legacy /api/user/packs/* and /api/bundles/* routes.
 *
 * The existing routers in backend/src/routes/userPacks.ts and routes/bundles.ts
 * remain mounted in app.ts for backward compatibility. This module additionally
 * exposes a /api/modules/menus/health endpoint as a marker for the new layout,
 * and is the foundation other modules will follow.
 */
function buildMenusSubrouter(): Hono {
  const sub = new Hono();
  sub.get("/health", (c) => c.json({ module: "menus", schema: "menu/v1" }));
  return sub;
}

export const menusModule: BackendModule = {
  id: "menus",
  schemaVersion: "menu/v1",
  registerRoutes: (app) => {
    app.route("/api/modules/menus", buildMenusSubrouter());
  },
};
