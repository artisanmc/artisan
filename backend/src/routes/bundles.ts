import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { packConflicts, serverKeys } from "../db/schema";
import { validateServerKeyHeader } from "../lib/auth";
import { computeBundleHash } from "../lib/hashUtils";
import { getPack, createPack, upsertPackContent } from "../lib/packStorage";
import { createBinding } from "../lib/packBindingManager";

const router = new Hono();

router.post("/:packId", async (c) => {
  const serverKeyId = await validateServerKeyHeader(c);
  if (!serverKeyId) return c.json({ error: "Unauthorized" }, 401);

  const packId = c.req.param("packId");

  const open = await db.select({ id: packConflicts.id }).from(packConflicts).where(and(
    eq(packConflicts.serverId, serverKeyId),
    eq(packConflicts.packId, packId),
    isNull(packConflicts.resolvedAt),
  ));
  if (open.length > 0) {
    return c.json({ error: "pack_locked", conflictId: open[0].id }, 409);
  }

  const body = await c.req.json<{ files: Record<string, string> }>();
  const hash = await computeBundleHash(body.files, packId);

  const sk = (await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId)))[0];
  if (!sk) return c.json({ error: "Server key missing" }, 500);

  let pack = await getPack(packId);
  if (!pack) {
    pack = await createPack({ networkId: sk.networkId, name: packId, id: packId });
    await createBinding(serverKeyId, packId);
  }
  await upsertPackContent(packId, { hash, filesJson: JSON.stringify(body.files) });
  return c.json({ ok: true });
});

router.get("/:packId", async (c) => {
  const serverKeyId = await validateServerKeyHeader(c);
  if (!serverKeyId) return c.json({ error: "Unauthorized" }, 401);

  const packId = c.req.param("packId");

  // TODO(C8): replace with packs-based lookup
  return c.json({ error: "Not implemented" }, 501);
});

export { router as bundlesRouter };
