import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./db/schema";
import { cors } from "hono/cors";
import { createBunWebSocket } from "hono/bun";
import { linkRouter } from "./routes/link";
import { serverKeysRouter } from "./routes/serverKeys";
import { texturesRouter } from "./routes/textures";
import { modelsRouter } from "./routes/models";
import { modelBundleRouter } from "./routes/modelBundle";
import { resourcePackPublicRouter } from "./routes/resourcePack";
import { authRouter } from "./routes/auth";
import { discordOauthRouter } from "./routes/discordOauth";
import { googleOauthRouter } from "./routes/googleOauth";
import { userNetworksRouter } from "./routes/userNetworks";
import { networkTransfersRouter } from "./routes/networkTransfers";
import { userProjectsRouter } from "./routes/userProjects";
import { projectDraftsRouter } from "./routes/projectDrafts";
import { projectContentRouter } from "./routes/projectContent";
import { projectCopiesRouter } from "./routes/projectCopies";
import { userAssetsRouter } from "./routes/userAssets";
import { userWsTicketRouter } from "./routes/userWsTicket";
import { invitesRouter } from "./routes/invites";
import { userAuth } from "./middleware/userAuth";
import {demoRouter} from './routes/demo';
import {refreshDemoResponse} from './middleware/demoAuth';
import { requireAdmin } from "./middleware/requireAdmin";
import { buildAssistantAdminRouter } from "./modules/assistant/adminRoutes";
import { buildAdminUsersRouter } from "./routes/adminUsers";
import { buildAiAdminRouter } from "./modules/ai/adminRoutes";
import { buildBillingAdminRouter } from "./modules/billing/adminRoutes";
import { buildBillingUserRouter } from "./modules/billing/userRoutes";
import { buildBillingWebhookRouter } from "./modules/billing/webhookRoutes";
import { cleanupConn, cleanupEditorConn, cleanupSession, handlePluginMessage, registerConn, registerEditorConn } from "./ws/hub";
import { redeemTicket } from "./lib/wsTickets";
import { listServerKeyIdsForUser } from "./lib/membershipGuard";
import { mountModules } from "@artisan/backend-sdk";
import { menusModule } from "./modules/menus";
import { commandsModule } from "./modules/commands";
import { assistantModule } from "./modules/assistant";
import { aiModule } from "./modules/ai";

const { upgradeWebSocket, websocket } = createBunWebSocket();
export const app = new Hono();
export { websocket };

const EDITOR_URL = process.env.EDITOR_URL ?? "http://localhost:5173";
app.use("/api/v1/*", cors({ origin: EDITOR_URL, credentials: true,exposeHeaders:['X-Artisan-Demo-Expires-At'] }));
app.use('/api/v1/*',refreshDemoResponse);

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/v1/server-keys", serverKeysRouter);
app.route("/api/v1/link", linkRouter);
app.route("/api/v1/textures", texturesRouter);
app.route("/api/v1/models", modelsRouter);
app.route("/api/v1/model-bundle", modelBundleRouter);
app.route("/api/v1/resource-pack", resourcePackPublicRouter);
app.route("/api/v1/auth", authRouter);
app.route("/api/v1/auth/discord", discordOauthRouter);
app.route("/api/v1/auth/google", googleOauthRouter);
app.use('/api/v1/demo/*',userAuth());
app.route('/api/v1/demo',demoRouter);
app.use("/api/v1/networks/*", userAuth());
app.route("/api/v1/networks", networkTransfersRouter);
app.route("/api/v1/networks", userNetworksRouter);
// userAuth() never 401s by itself (sets user=null on missing/invalid
// cookie) — GET /:code stays public, POST /:code/accept checks c.get("user").
app.use("/api/v1/invites/*", userAuth());
app.route("/api/v1/invites", invitesRouter);
app.use("/api/v1/user/projects/*", userAuth());
app.route("/api/v1/user/projects", userProjectsRouter);
app.route("/api/v1/user/projects", projectDraftsRouter);
app.route("/api/v1/user/projects", projectCopiesRouter);
app.use("/api/v1/projects/*", userAuth());
app.route("/api/v1/projects", projectContentRouter);
app.route("/api/v1/user/projects", userAssetsRouter);
app.use("/api/v1/user/ws-ticket", userAuth());
app.route("/api/v1/user/ws-ticket", userWsTicketRouter);
app.route("/api/v1/billing", buildBillingWebhookRouter());
app.use("/api/v1/billing/*", userAuth());
app.route("/api/v1/billing", buildBillingUserRouter());

app.use("/api/v1/admin/*", userAuth());
app.use("/api/v1/admin/*", requireAdmin());
app.route("/api/v1/admin", buildAssistantAdminRouter());
app.route("/api/v1/admin", buildAdminUsersRouter());
app.route("/api/v1/admin", buildAiAdminRouter());
app.route("/api/v1/admin", buildBillingAdminRouter());

mountModules(app, [menusModule, commandsModule, assistantModule, aiModule]);

app.get(
  "/ws/plugin",
  upgradeWebSocket((c) => {
    const connId = crypto.randomUUID();
    const sourceIp = c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "unknown";
    let sessionId: string | undefined;
    return {
      onOpen(_, ws) {
        registerConn(connId, (msg) => ws.send(msg));
      },
      async onMessage(evt, ws) {
        const raw = typeof evt.data === "string" ? evt.data : await (evt.data as Blob).text();
        const result = await handlePluginMessage(connId, raw, sourceIp);
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
    const url = new URL(c.req.url);
    const ticket = url.searchParams.get("ticket") ?? "";
    // One-shot user-ticket path (Task 4): subscribes to the full set of
    // serverKeyIds across all of the user's networks, not a single one.
    const redeemed = ticket ? redeemTicket(ticket) : null;
    if (!redeemed) return c.json({ error: "Unauthorized" }, 401);
    const serverKeyIds = await listServerKeyIdsForUser(redeemed.userId);
    c.set("editorUserId", redeemed.userId);
    c.set("editorServerIds", new Set(serverKeyIds));
    c.set("editorWsSessionId", "user_" + crypto.randomUUID());
    return next();
  },
  upgradeWebSocket((c) => {
    const serverIds = c.get("editorServerIds") as Set<string>;
    const sessionId = c.get("editorWsSessionId") as string;
    return {
      async onOpen(_, ws) {
        const userId = c.get("editorUserId") as string;
        registerEditorConn(sessionId, serverIds, (msg) => ws.send(msg), { userId, close: () => ws.close(1008, "Account deleted") });
        // Registration precedes this check so deletion during upgrade also closes this socket.
        const exists = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).catch(() => []);
        if (!exists.length) { cleanupEditorConn(sessionId); ws.close(1008, "Account unavailable"); }
      },
      onMessage() {},
      onClose() { cleanupEditorConn(sessionId); },
      onError: (err) => console.error("Editor WS error:", err),
    };
  }),
);
