import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { packBundles, packConflicts } from "../db/schema";
import { validateAccessToken } from "../lib/auth";
import { computeConflictDiff } from "../lib/conflictDiff";
import { computeBundleHash } from "../lib/hashUtils";
import { readEditorLayoutFromFiles, importPackFromFiles, isEmptyStub } from "../lib/packImport";
import { editorSenders, editorTokenToServer, pushBundleAvailable } from "../ws/hub";

const router = new Hono();

router.get("/:token/conflicts", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const conflicts = await db.select().from(packConflicts).where(and(
    eq(packConflicts.serverId, session.serverKeyId),
    isNull(packConflicts.resolvedAt),
  ));
  if (conflicts.length === 0) return c.json({ conflicts: [] });

  const packIds = conflicts.map((cf) => cf.packId);
  const bundles = await db.select({ packId: packBundles.packId, filesJson: packBundles.filesJson }).from(packBundles)
    .where(eq(packBundles.serverId, session.serverKeyId));
  const filesByPack: Record<string, Record<string, string>> = {};
  for (const b of bundles) {
    if (packIds.includes(b.packId)) filesByPack[b.packId] = JSON.parse(b.filesJson);
  }

  const summaries = conflicts.map((cf) => {
    const diskFiles = JSON.parse(cf.diskFilesJson) as Record<string, string>;
    const backendFiles = filesByPack[cf.packId] ?? {};
    const diff = computeConflictDiff(diskFiles, backendFiles);
    return {
      id: cf.id,
      packId: cf.packId,
      detectedAt: cf.detectedAt.toISOString(),
      diskHash: cf.diskHash,
      backendHashAtDetection: cf.backendHashAtDetection,
      fileCount: Object.keys(diskFiles).length,
      diff,
    };
  });
  return c.json({ conflicts: summaries });
});

router.get("/:token/conflicts/:id", async (c) => {
  const token = c.req.param("token");
  const id = c.req.param("id");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const rows = await db.select().from(packConflicts).where(and(
    eq(packConflicts.id, id),
    eq(packConflicts.serverId, session.serverKeyId),
  ));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const cf = rows[0];
  const diskFiles = JSON.parse(cf.diskFilesJson) as Record<string, string>;
  const backendRows = await db.select({ filesJson: packBundles.filesJson }).from(packBundles).where(and(
    eq(packBundles.serverId, session.serverKeyId),
    eq(packBundles.packId, cf.packId),
  ));
  const backendFiles = backendRows.length > 0 ? JSON.parse(backendRows[0].filesJson) : {};
  return c.json({
    conflict: {
      id: cf.id,
      packId: cf.packId,
      detectedAt: cf.detectedAt.toISOString(),
      diskHash: cf.diskHash,
      backendHashAtDetection: cf.backendHashAtDetection,
      fileCount: Object.keys(diskFiles).length,
      diff: computeConflictDiff(diskFiles, backendFiles),
      diskFiles,
    },
  });
});

router.post("/:token/conflicts/:id/resolve", async (c) => {
  const token = c.req.param("token");
  const id = c.req.param("id");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ choice: "editor" | "server" }>().catch(() => null);
  if (!body || (body.choice !== "editor" && body.choice !== "server")) {
    return c.json({ error: "invalid_choice" }, 400);
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const open = await tx.select().from(packConflicts).where(and(
      eq(packConflicts.id, id),
      eq(packConflicts.serverId, session.serverKeyId),
      isNull(packConflicts.resolvedAt),
    ));
    if (open.length === 0) return null;
    const cf = open[0];

    let newHash = cf.backendHashAtDetection;
    if (body.choice === "server") {
      const diskFiles = JSON.parse(cf.diskFilesJson) as Record<string, string>;
      newHash = await computeBundleHash(diskFiles, cf.packId);

      const existing = await tx.select({ editorJson: packBundles.editorJson }).from(packBundles)
        .where(and(eq(packBundles.serverId, cf.serverId), eq(packBundles.packId, cf.packId)));
      const incomingLayout = readEditorLayoutFromFiles(diskFiles, cf.packId);
      let editorJsonObj: Record<string, unknown>;
      if (existing.length > 0 && !isEmptyStub(existing[0].editorJson)) {
        editorJsonObj = JSON.parse(existing[0].editorJson!) as Record<string, unknown>;
      } else {
        editorJsonObj = importPackFromFiles(cf.packId, diskFiles) as Record<string, unknown>;
      }
      editorJsonObj.canvasLayout = incomingLayout;
      await tx.update(packBundles).set({
        filesJson: cf.diskFilesJson,
        hash: newHash,
        editorJson: JSON.stringify(editorJsonObj),
      }).where(and(eq(packBundles.serverId, cf.serverId), eq(packBundles.packId, cf.packId)));
    }

    await tx.update(packConflicts).set({ resolvedAt: now, resolution: body.choice })
      .where(eq(packConflicts.id, cf.id));
    return { newHash, serverId: cf.serverId, packId: cf.packId };
  });

  if (!result) return c.json({ error: "already_resolved" }, 409);

  await pushBundleAvailable(result.serverId, result.packId, result.newHash);

  const payload = JSON.stringify({
    type: "pack_conflict_resolved",
    conflict_id: id,
    pack_id: result.packId,
    resolution: body.choice,
  });
  for (const [sessionId, sId] of editorTokenToServer) {
    if (sId !== result.serverId) continue;
    const send = editorSenders.get(sessionId);
    if (send) send(payload);
  }

  return c.json({ resolved: true, newHash: result.newHash });
});

export { router as conflictsRouter };
