import { Hono } from "hono";
import { cors } from "hono/cors";
import { createBunWebSocket } from "hono/bun";
import { bundlesRouter } from "./routes/bundles";
import { editorSessionRouter } from "./routes/editorSession";
import { linkRouter } from "./routes/link";
import { serverKeysRouter } from "./routes/serverKeys";
import { cleanupConn, cleanupSession, handlePluginMessage, registerConn } from "./ws/hub";

const { upgradeWebSocket, websocket } = createBunWebSocket();
export const app = new Hono();
export { websocket };

const EDITOR_URL = process.env.EDITOR_URL ?? "http://localhost:5173";
app.use("/api/*", cors({ origin: EDITOR_URL }));

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/server-keys", serverKeysRouter);
app.route("/api/bundles", bundlesRouter);
app.route("/api/link", linkRouter);
app.route("/api/editor-session", editorSessionRouter);

app.get(
  "/ws/plugin",
  upgradeWebSocket(() => {
    const connId = crypto.randomUUID();
    let sessionId: string | undefined;
    return {
      onOpen(_, ws) {
        registerConn(connId, (msg) => ws.send(msg));
      },
      async onMessage(evt, ws) {
        const raw = typeof evt.data === "string" ? evt.data : await (evt.data as Blob).text();
        const result = await handlePluginMessage(connId, raw);
        if (result.reply) ws.send(result.reply);
        for (const msg of result.push ?? []) ws.send(msg);
        if (result.sessionId) sessionId = result.sessionId;
      },
      onClose() {
        cleanupConn(connId);
        if (sessionId) cleanupSession(sessionId);
      },
      onError: (err) => console.error("WS error:", err),
    };
  }),
);
