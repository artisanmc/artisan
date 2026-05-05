import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { bundlesRouter } from "./routes/bundles";
import { serverKeysRouter } from "./routes/serverKeys";
import { cleanupSession, handlePluginMessage } from "./ws/hub";

const { upgradeWebSocket, websocket } = createBunWebSocket();

export const app = new Hono();
export { websocket };

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/server-keys", serverKeysRouter);
app.route("/api/bundles", bundlesRouter);

app.get(
  "/ws/plugin",
  upgradeWebSocket(() => {
    let sessionId: string | undefined;
    return {
      async onMessage(evt, ws) {
        const raw = typeof evt.data === "string" ? evt.data : await (evt.data as Blob).text();
        const result = await handlePluginMessage(raw);
        if (result.reply) ws.send(result.reply);
        for (const msg of result.push ?? []) ws.send(msg);
        if (result.sessionId) sessionId = result.sessionId;
      },
      onClose() {
        if (sessionId) cleanupSession(sessionId);
      },
      onError: (err) => console.error("WS error:", err),
    };
  }),
);
