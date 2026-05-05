import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { serverKeysRouter } from "./routes/serverKeys";
import { handlePluginMessage } from "./ws/hub";

const { upgradeWebSocket, websocket } = createBunWebSocket();

export const app = new Hono();
export { websocket };

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/server-keys", serverKeysRouter);

app.get(
  "/ws/plugin",
  upgradeWebSocket(() => ({
    async onMessage(evt, ws) {
      const raw = typeof evt.data === "string" ? evt.data : await (evt.data as Blob).text();
      const reply = await handlePluginMessage(raw);
      if (reply) ws.send(reply);
    },
    onError: (err) => console.error("WS error:", err),
  })),
);
