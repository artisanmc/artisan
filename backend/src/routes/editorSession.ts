import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { editorSessions, packBundles } from "../db/schema";
import { validateEditorToken } from "../lib/auth";
import { checkRateLimit } from "../lib/rateLimit";
import { computeBundleHash } from "../lib/hashUtils";
import { broadcastDraftUpdate, pushBundleAvailable } from "../ws/hub";

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

router.get("/:token/packs", async (c) => {
  const token = c.req.param("token");
  const session = await validateEditorToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const rows = await db
    .select()
    .from(packBundles)
    .where(eq(packBundles.serverId, session.serverKeyId));

  const packs = rows
    .filter((r) => r.editorJson != null)
    .map((r) => JSON.parse(r.editorJson!));

  return c.json({ packs });
});

router.put("/:token/packs/:packId", async (c) => {
  const token = c.req.param("token");
  const packId = c.req.param("packId");
  const session = await validateEditorToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ pack: unknown; files: Record<string, string> }>();
  const hash = await computeBundleHash(body.files, packId);

  await db.transaction(async (tx) => {
    await tx.delete(packBundles).where(
      and(eq(packBundles.serverId, session.serverKeyId), eq(packBundles.packId, packId))
    );
    await tx.insert(packBundles).values({
      id: crypto.randomUUID(),
      serverId: session.serverKeyId,
      packId,
      hash,
      filesJson: JSON.stringify(body.files),
      editorJson: JSON.stringify(body.pack),
      createdAt: new Date(),
    });
  });

  pushBundleAvailable(session.serverKeyId, packId, hash);
  return c.json({ hash }, 201);
});

router.delete("/:token/packs/:packId", async (c) => {
  const token = c.req.param("token");
  const packId = c.req.param("packId");
  const session = await validateEditorToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  await db.delete(packBundles).where(
    and(eq(packBundles.serverId, session.serverKeyId), eq(packBundles.packId, packId))
  );
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
