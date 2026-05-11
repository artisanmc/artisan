import { Hono } from "hono";
import { and, eq, ilike } from "drizzle-orm";
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

assetsRouter.get("/:token/assets", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const typeParam = c.req.query("type");
  const searchParam = c.req.query("search");

  const conditions = [eq(assets.serverKeyId, session.serverKeyId)];
  if (typeParam && ["texture", "glyph", "font"].includes(typeParam)) {
    conditions.push(eq(assets.type, typeParam));
  }
  if (searchParam) {
    conditions.push(ilike(assets.name, `%${searchParam}%`));
  }

  const rows = await db.select().from(assets).where(and(...conditions));
  return c.json({ assets: rows.map(serialize) });
});

assetsRouter.get("/:token/assets/:id", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const rows = await db.select().from(assets)
    .where(and(eq(assets.id, id), eq(assets.serverKeyId, session.serverKeyId)));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ asset: serialize(rows[0]) });
});

assetsRouter.patch("/:token/assets/:id", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const rows = await db.select().from(assets)
    .where(and(eq(assets.id, id), eq(assets.serverKeyId, session.serverKeyId)));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const current = rows[0];

  const body = await c.req.json().catch(() => ({}));
  const patch: { name?: string; ascent?: number; updatedAt: Date } = { updatedAt: new Date() };

  if (typeof body.name === "string") {
    if (!NAME_RE.test(body.name)) return c.json({ error: "Invalid name" }, 400);
    if (body.name !== current.name) {
      const clash = await db.select().from(assets).where(and(
        eq(assets.serverKeyId, session.serverKeyId),
        eq(assets.type, current.type),
        eq(assets.name, body.name),
      ));
      if (clash.length > 0) return c.json({ error: "Asset name already exists" }, 409);
      patch.name = body.name;
    }
  }
  if (typeof body.ascent === "number") {
    if (current.type !== "glyph") return c.json({ error: "ascent only valid for glyph" }, 400);
    patch.ascent = body.ascent;
  }

  await db.update(assets).set(patch).where(eq(assets.id, id));
  const updated = (await db.select().from(assets).where(eq(assets.id, id)))[0];
  return c.json({ asset: serialize(updated) });
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
