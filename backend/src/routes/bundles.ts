import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";
import { validateServerKeyHeader } from "../lib/auth";
import { computeBundleHash } from "../lib/hashUtils";
import { getPack, createPack, upsertPackContent } from "../lib/packStorage";
import { createBinding, listPacksForServerKey } from "../lib/packBindingManager";

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
    pack = await createPack({ networkId: sk.networkId, name: packId, id: packId });
  }
  // Ensure THIS server_key has a binding to the pack. The pack may have been
  // created by a different server_key (e.g. multi-server-sync scenario); we
  // still need the binding for `listPacksForServerKey` to surface it.
  const bound = await listPacksForServerKey(serverKeyId);
  if (!bound.find((p) => p.id === packId)) {
    await createBinding(serverKeyId, packId);
  }
  await upsertPackContent(packId, { hash, filesJson: JSON.stringify(body.files) });
  return c.json({ ok: true, hash });
});

router.get("/:packId", async (c) => {
  const serverKeyId = await validateServerKeyHeader(c);
  if (!serverKeyId) return c.json({ error: "Unauthorized" }, 401);

  const packId = c.req.param("packId");

  const bound = await listPacksForServerKey(serverKeyId);
  if (!bound.find((p) => p.id === packId)) return c.json({ error: "Not bound" }, 404);

  const pack = await getPack(packId);
  if (!pack || pack.deletedAt) return c.json({ error: "Not found" }, 404);

  return c.json({ hash: pack.hash, files: JSON.parse(pack.filesJson) as Record<string, string> });
});

export { router as bundlesRouter };
