import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { editorSessions } from "../db/schema";
import { validateEditorToken } from "../lib/auth";
import { checkRateLimit } from "../lib/rateLimit";
import { broadcastDraftUpdate } from "../ws/hub";

const router = new Hono();

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "unknown";
}

router.get("/:token", async (c) => {
  if (!checkRateLimit(`editor-validate:${clientIp(c)}`, 20)) return c.json({ error: "Too many requests" }, 429);
  const token = c.req.param("token");
  const session = await validateEditorToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ server_key_id: session.serverKeyId });
});

router.post("/:token/refresh", async (c) => {
  const token = c.req.param("token");
  const session = await validateEditorToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await db.update(editorSessions).set({ expiresAt }).where(eq(editorSessions.token, token));
  return c.json({ expires_at: expiresAt.toISOString() });
});

router.delete("/:token", async (c) => {
  const token = c.req.param("token");
  const session = await validateEditorToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  await db.update(editorSessions).set({ revokedAt: new Date() }).where(eq(editorSessions.token, token));
  return c.json({ ok: true });
});

router.post("/:token/draft", async (c) => {
  const token = c.req.param("token");
  const session = await validateEditorToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ pack_id: string; menu_id: string; menu_yaml: string }>();
  broadcastDraftUpdate(session.serverKeyId, body.pack_id, body.menu_id, body.menu_yaml, token);
  return c.json({ ok: true });
});

export { router as editorSessionRouter };
