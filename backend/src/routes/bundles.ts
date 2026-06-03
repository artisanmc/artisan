import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { serverKeys, packs, packBranches, packCommits } from "../db/schema";
import { validateServerKeyHeader } from "../lib/auth";
import { computeBundleHash } from "../lib/hashUtils";
import { getPack, createPack, upsertPackContent } from "../lib/packStorage";

const router = new Hono();

router.post("/:packId", async (c) => {
  const serverKeyId = await validateServerKeyHeader(c);
  if (!serverKeyId) return c.json({ error: "Unauthorized" }, 401);

  const packId = c.req.param("packId");

  const body = await c.req.json<{ files: Record<string, string> }>();
  const hash = await computeBundleHash(body.files, packId);

  const sk = (await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId)))[0];
  if (!sk) return c.json({ error: "Server key missing" }, 500);

  let pack = await getPack(packId);
  if (!pack) {
    pack = await createPack({ networkId: sk.networkId, serverKeyId: sk.id, name: packId, id: packId });
  }
  await upsertPackContent(packId, { hash, filesJson: JSON.stringify(body.files) });
  return c.json({ ok: true, hash });
});

router.get("/:packId", async (c) => {
  const serverKeyId = await validateServerKeyHeader(c);
  if (!serverKeyId) return c.json({ error: "Unauthorized" }, 401);

  const packId = c.req.param("packId");

  // Verify the pack belongs to this server_key (1:1 ownership via packs.serverKeyId)
  const packRow = (await db.select().from(packs).where(and(
    eq(packs.id, packId),
    eq(packs.serverKeyId, serverKeyId),
  )))[0];
  if (!packRow) return c.json({ error: "Not bound" }, 404);

  const branch = (await db.select().from(packBranches).where(and(
    eq(packBranches.packId, packId), eq(packBranches.name, "main"),
  )))[0];
  if (!branch) return c.json({ error: "Branch not found" }, 404);

  const commit = (await db.select().from(packCommits).where(eq(packCommits.id, branch.headCommitId)))[0];
  if (!commit) return c.json({ error: "Commit not found" }, 500);

  return c.json({
    hash: commit.contentHash,
    files: JSON.parse(commit.filesJson) as Record<string, string>,
  });
});

export { router as bundlesRouter };
