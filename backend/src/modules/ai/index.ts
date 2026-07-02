import type { Hono } from "hono";
import type { BackendModule } from "@artisan/backend-sdk";
import { buildAiRouter } from "./routes";

export const aiModule: BackendModule = {
	id: "ai",
	schemaVersion: "none",
	registerRoutes: (app: Hono) => {
		app.route("/api/v1/ai", buildAiRouter());
	},
};
