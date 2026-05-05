import { Hono } from "hono";
import { serverKeysRouter } from "./routes/serverKeys";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/server-keys", serverKeysRouter);
