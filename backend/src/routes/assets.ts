import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "../db/index";
import { assets } from "../db/schema";
import { validateAccessToken } from "../lib/auth";
import { writeAssetFile } from "../lib/assetStorage";
import { readPngDimensions } from "../lib/pngDimensions";
import { allocateCodepoint } from "../lib/codepointAllocator";

export const assetsRouter = new Hono();

const NAME_RE = /^[a-z0-9_-]+$/;
const MAX_RAW_BYTES = 2 * 1024 * 1024;   // 2 MB

assetsRouter.post("/:token/assets", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const form = await c.req.parseBody();
  const type = String(form.type ?? "");
  const name = String(form.name ?? "");
  const ascentRaw = form.ascent !== undefined ? String(form.ascent) : null;
  const file = form.file;

  if (!["texture", "glyph"].includes(type)) {
    return c.json({ error: "Invalid type (must be texture or glyph)" }, 400);
  }
  if (!NAME_RE.test(name)) {
    return c.json({ error: "Invalid name (must match [a-z0-9_-]+)" }, 400);
  }
  if (!(file instanceof File)) {
    return c.json({ error: "Missing file" }, 400);
  }
  if (file.size > MAX_RAW_BYTES) {
    return c.json({ error: "File too large (max 2 MB)" }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let width: number;
  let height: number;
  try {
    const dims = readPngDimensions(bytes);
    width = dims.width;
    height = dims.height;
  } catch {
    return c.json({ error: "Invalid PNG" }, 400);
  }

  const contentHash = createHash("sha1").update(bytes).digest("hex");

  // Dedup: same (serverKeyId, contentHash) → return existing row.
  const existing = await db.select().from(assets)
    .where(and(eq(assets.serverKeyId, session.serverKeyId), eq(assets.contentHash, contentHash)));
  if (existing.length > 0) {
    return c.json({ asset: serialize(existing[0]) }, 200);
  }

  // Name uniqueness within type — detect early for a clean error message
  const nameClash = await db.select().from(assets).where(
    and(eq(assets.serverKeyId, session.serverKeyId), eq(assets.type, type), eq(assets.name, name)),
  );
  if (nameClash.length > 0) {
    return c.json({ error: "Asset name already exists" }, 409);
  }

  let ascent: number | null = null;
  let codepoint: number | null = null;
  if (type === "glyph") {
    ascent = ascentRaw !== null ? parseInt(ascentRaw, 10) : height - 1;
    if (!Number.isFinite(ascent)) return c.json({ error: "Invalid ascent" }, 400);
    codepoint = await allocateCodepoint(session.serverKeyId);
  }

  const id = "asset_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const now = new Date();

  try {
    await writeAssetFile(session.serverKeyId, id, bytes);
    await db.insert(assets).values({
      id,
      serverKeyId: session.serverKeyId,
      type,
      name,
      width,
      height,
      ascent,
      codepoint,
      fontMeta: null,
      contentHash,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    // Race condition: pre-SELECT passed but the DB unique constraint fired.
    // Postgres "unique_violation" error code = 23505.
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return c.json({ error: "Asset name already exists" }, 409);
    }
    return c.json({ error: "Failed to persist asset" }, 500);
  }

  const created = (await db.select().from(assets).where(eq(assets.id, id)))[0];
  return c.json({ asset: serialize(created) }, 201);
});

function serialize(row: typeof assets.$inferSelect) {
  return {
    id: row.id,
    serverKeyId: row.serverKeyId,
    type: row.type as "texture" | "glyph" | "font",
    name: row.name,
    width: row.width,
    height: row.height,
    ascent: row.ascent,
    codepoint: row.codepoint,
    fontMeta: row.fontMeta,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
