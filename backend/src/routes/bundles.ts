import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { packBundles } from "../db/schema";
import { validateServerKeyHeader } from "../lib/auth";
import { computeBundleHash } from "../lib/hashUtils";
import { importPackFromFiles, isEmptyStub, readEditorLayoutFromFiles } from "../lib/packImport";

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

    const incomingLayout = readEditorLayoutFromFiles(body.files, packId);

    let editorJsonObj: Record<string, unknown>;
    if (existing.length > 0 && !isEmptyStub(existing[0].editorJson)) {
      editorJsonObj = JSON.parse(existing[0].editorJson!) as Record<string, unknown>;
    } else {
      editorJsonObj = importPackFromFiles(packId, body.files) as Record<string, unknown>;
    }
    editorJsonObj.canvasLayout = incomingLayout; // files win

    const keepEditorJson = JSON.stringify(editorJsonObj);

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
