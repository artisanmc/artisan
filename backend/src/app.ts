import { Hono } from "hono";
import { cors } from "hono/cors";
import { createBunWebSocket } from "hono/bun";
import { bundlesRouter } from "./routes/bundles";
import { editorSessionRouter } from "./routes/editorSession";
import { linkRouter } from "./routes/link";
import { serverKeysRouter } from "./routes/serverKeys";
import { texturesRouter } from "./routes/textures";
import { modelsRouter } from "./routes/models";
import { modelBundleRouter } from "./routes/modelBundle";
import { assetsRouter } from "./routes/assets";
import { resourcePackPublicRouter, resourcePackAdminRouter } from "./routes/resourcePack";
import { conflictsRouter } from "./routes/conflicts";
import { authRouter } from "./routes/auth";
import { discordOauthRouter } from "./routes/discordOauth";
import { userNetworksRouter } from "./routes/userNetworks";
import { userAuth } from "./middleware/userAuth";
import { cleanupConn, cleanupEditorConn, cleanupSession, handlePluginMessage, registerConn, registerEditorConn, trackEditorIp } from "./ws/hub";
import { validateAccessToken } from "./lib/auth";

const { upgradeWebSocket, websocket } = createBunWebSocket();
export const app = new Hono();
export { websocket };

const EDITOR_URL = process.env.EDITOR_URL ?? "http://localhost:5173";
app.use("/api/*", cors({ origin: EDITOR_URL, credentials: true }));

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/server-keys", serverKeysRouter);
app.route("/api/bundles", bundlesRouter);
app.route("/api/link", linkRouter);
app.route("/api/editor-session", editorSessionRouter);
app.route("/api/textures", texturesRouter);
app.route("/api/models", modelsRouter);
app.route("/api/model-bundle", modelBundleRouter);
app.route("/api/editor-session", assetsRouter);
app.route("/api/resource-pack", resourcePackPublicRouter);
app.route("/api/editor-session", resourcePackAdminRouter);
app.route("/api/editor-session", conflictsRouter);
app.route("/api/auth", authRouter);
app.route("/api/auth/discord", discordOauthRouter);
app.use("/api/networks/*", userAuth());
app.route("/api/networks", userNetworksRouter);

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

app.get(
  "/ws/editor",
  async (c, next) => {
    const token = new URL(c.req.url).searchParams.get("token") ?? "";
    const session = token ? await validateAccessToken(token) : null;
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    c.set("editorToken", token);
    c.set("editorServerId", session.serverKeyId);
    c.set("editorSessionId", session.sessionId);
    c.set("editorIp", c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "unknown");
    return next();
  },
  upgradeWebSocket((c) => {
    const serverId = c.get("editorServerId") as string;
    const sessionId = c.get("editorSessionId") as string;
    const ip = c.get("editorIp") as string;
    return {
      onOpen(_, ws) {
        registerEditorConn(sessionId, serverId, (msg) => ws.send(msg));
        trackEditorIp(sessionId, ip);
      },
      onMessage() {},
      onClose() { cleanupEditorConn(sessionId); },
      onError: (err) => console.error("Editor WS error:", err),
    };
  }),
);
