import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { packBundles } from "../db/schema";
import { validateServerKeyHeader } from "../lib/auth";
import { computeBundleHash } from "../lib/hashUtils";
import { importPackFromFiles, isEmptyStub } from "../lib/packImport";

const router = new Hono();

router.post("/:packId", async (c) => {
  const serverId = await validateServerKeyHeader(c);
  if (!serverId) return c.json({ error: "Unauthorized" }, 401);

  const packId = c.req.param("packId");
  const body = await c.req.json<{ files: Record<string, string> }>();
  const hash = await computeBundleHash(body.files, packId);

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: packBundles.id, editorJson: packBundles.editorJson })
      .from(packBundles)
      .where(and(eq(packBundles.serverId, serverId), eq(packBundles.packId, packId)));

    // Preserve rich editorJson written by the editor; generate from files only when the
    // current editorJson is empty (stub) or absent.
    const keepEditorJson = existing.length > 0 && !isEmptyStub(existing[0].editorJson)
      ? existing[0].editorJson
      : JSON.stringify(importPackFromFiles(packId, body.files));

    if (existing.length > 0) {
      await tx.update(packBundles)
        .set({ hash, filesJson: JSON.stringify(body.files), editorJson: keepEditorJson })
        .where(and(eq(packBundles.serverId, serverId), eq(packBundles.packId, packId)));
    } else {
      await tx.insert(packBundles).values({
        id: crypto.randomUUID(),
        serverId,
        packId,
        hash,
        filesJson: JSON.stringify(body.files),
        editorJson: keepEditorJson,
        createdAt: new Date(),
      });
    }
  });

  return c.json({ hash }, 201);
});

router.get("/:packId", async (c) => {
  const serverId = await validateServerKeyHeader(c);
  if (!serverId) return c.json({ error: "Unauthorized" }, 401);

  const packId = c.req.param("packId");
  const rows = await db
    .select()
    .from(packBundles)
    .where(and(eq(packBundles.serverId, serverId), eq(packBundles.packId, packId)));

  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const row = rows[0];
  return c.json({ files: JSON.parse(row.filesJson) as Record<string, string>, hash: row.hash });
});

export { router as bundlesRouter };
