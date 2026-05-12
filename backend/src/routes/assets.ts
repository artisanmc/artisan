import { Hono } from "hono";
import { and, eq, ilike } from "drizzle-orm";
import { createHash } from "crypto";
import { strToU8 } from "fflate";
import { readFile } from "fs/promises";
import { db } from "../db/index";
import { assets } from "../db/schema";
import { validateAccessToken } from "../lib/auth";
import { writeAssetFile, deleteAssetFile, assetPath } from "../lib/assetStorage";
import { writeFontAssets, deleteFontAssets } from "../lib/fontStorage";
import { parseMcFontsZip, type ParsedMcFont } from "../lib/mcFontsParser";
import { readPngDimensions } from "../lib/pngDimensions";
import { allocateCodepoint } from "../lib/codepointAllocator";
import { rebuildResourcePack } from "../lib/resourcePack";
import { pushResourcePackUpdated } from "../ws/hub";

export const assetsRouter = new Hono();

const NAME_RE = /^[a-z0-9_-]+$/;
const MAX_RAW_BYTES = 2 * 1024 * 1024;       // 2 MB (texture/glyph PNG)
const MAX_FONT_BYTES = 5 * 1024 * 1024;      // 5 MB (font zip)

assetsRouter.post("/:token/assets", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const form = await c.req.parseBody();
  const type = String(form.type ?? "");
  const name = String(form.name ?? "");
  const ascentRaw = form.ascent !== undefined ? String(form.ascent) : null;
  const file = form.file;

  if (!["texture", "glyph", "font"].includes(type)) {
    return c.json({ error: "Invalid type (must be texture, glyph, or font)" }, 400);
  }
  if (!NAME_RE.test(name)) {
    return c.json({ error: "Invalid name (must match [a-z0-9_-]+)" }, 400);
  }
  if (!(file instanceof File)) {
    return c.json({ error: "Missing file" }, 400);
  }
  const maxBytes = type === "font" ? MAX_FONT_BYTES : MAX_RAW_BYTES;
  if (file.size > maxBytes) {
    const mb = type === "font" ? 5 : 2;
    return c.json({ error: `File too large (max ${mb} MB)` }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // For texture/glyph, read PNG dims. For fonts, dimensions stay 0/0 (per-glyph dims
  // live inside fontMeta.glyphMap[]).
  let width = 0;
  let height = 0;
  let parsedFont: ParsedMcFont | null = null;

  if (type === "font") {
    try {
      parsedFont = parseMcFontsZip(bytes);
    } catch (err) {
      return c.json({ error: `Invalid font zip: ${(err as Error).message}` }, 400);
    }
    if (parsedFont.glyphMap.length === 0) {
      return c.json({ error: "Empty font (no usable glyphs)" }, 400);
    }
  } else {
    try {
      const dims = readPngDimensions(bytes);
      width = dims.width;
      height = dims.height;
    } catch {
      return c.json({ error: "Invalid PNG" }, 400);
    }
  }

  const contentHash = createHash("sha1").update(bytes).digest("hex");

  // Dedup: same (serverKeyId, type, contentHash) → return existing row.
  // Scoped by type so the same bytes can be uploaded as both a texture and a glyph.
  const existing = await db.select().from(assets).where(and(
    eq(assets.serverKeyId, session.serverKeyId),
    eq(assets.type, type),
    eq(assets.contentHash, contentHash),
  ));
  if (existing.length > 0) {
    const _packInfo = await rebuildResourcePack(session.serverKeyId);
    pushResourcePackUpdated(session.serverKeyId, _packInfo.url, _packInfo.hash);
    const body: Record<string, unknown> = { asset: serialize(existing[0]) };
    if (parsedFont) body.warnings = parsedFont.warnings;
    return c.json(body, 200);
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

  let fontMeta: { namespace: string; glyphMap: ParsedMcFont["glyphMap"] } | null = null;
  if (type === "font" && parsedFont) {
    fontMeta = {
      namespace: `interfaze:${name}`,
      glyphMap: parsedFont.glyphMap,
    };
  }

  try {
    if (type === "font" && parsedFont) {
      // Re-serialize font.json with canonical pack-namespaced file paths so the
      // resource pack zip emits valid references: interfaze:font/<name>/<basename>.
      const providers = parsedFont.glyphMap.map((g) => ({
        type: "bitmap",
        file: `interfaze:font/${name}/${g.texture}`,
        ascent: g.ascent,
        height: g.height,
        chars: [g.char],
      }));
      const fontJsonContent = strToU8(JSON.stringify({ providers }, null, 2));
      await writeFontAssets(session.serverKeyId, id, fontJsonContent, parsedFont.glyphPngs);
    } else {
      await writeAssetFile(session.serverKeyId, id, bytes);
    }
    await db.insert(assets).values({
      id,
      serverKeyId: session.serverKeyId,
      type,
      name,
      width,
      height,
      ascent,
      codepoint,
      fontMeta,
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
  const _packInfo = await rebuildResourcePack(session.serverKeyId);
  pushResourcePackUpdated(session.serverKeyId, _packInfo.url, _packInfo.hash);
  const body: Record<string, unknown> = { asset: serialize(created) };
  if (parsedFont) body.warnings = parsedFont.warnings;
  return c.json(body, 201);
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
  const patch: { name?: string; ascent?: number; height?: number; updatedAt: Date } = { updatedAt: new Date() };

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
  if (typeof body.height === "number") {
    if (current.type !== "glyph") return c.json({ error: "height only valid for glyph" }, 400);
    if (!Number.isInteger(body.height) || body.height < 1 || body.height > 256) {
      return c.json({ error: "Invalid height (must be integer between 1 and 256)" }, 400);
    }
    patch.height = body.height;
  }

  try {
    await db.update(assets).set(patch).where(eq(assets.id, id));
  } catch (err) {
    // Race condition: pre-SELECT passed but the DB unique constraint fired
    // when another request renamed a different asset to the same name.
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return c.json({ error: "Asset name already exists" }, 409);
    }
    return c.json({ error: "Failed to persist asset" }, 500);
  }
  const updated = (await db.select().from(assets).where(eq(assets.id, id)))[0];
  const _packInfo = await rebuildResourcePack(session.serverKeyId);
  pushResourcePackUpdated(session.serverKeyId, _packInfo.url, _packInfo.hash);
  return c.json({ asset: serialize(updated) });
});

assetsRouter.post("/:token/assets/:id/duplicate", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const rows = await db.select().from(assets)
    .where(and(eq(assets.id, id), eq(assets.serverKeyId, session.serverKeyId)));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const source = rows[0];

  if (source.type !== "glyph") {
    return c.json({ error: "Only glyph assets can be duplicated" }, 400);
  }

  // Pick a free name: "<name>_copy", "<name>_copy2", "<name>_copy3", ...
  const newName = await findFreeCopyName(session.serverKeyId, source.type, source.name);

  // New unique id
  const newId = "asset_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const newCodepoint = await allocateCodepoint(session.serverKeyId);
  const now = new Date();

  // Copy the source PNG to the new asset path
  let bytes: Uint8Array;
  try {
    const buf = await readFile(assetPath(session.serverKeyId, source.id));
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return c.json({ error: "Source asset file missing on disk" }, 500);
    }
    throw err;
  }

  try {
    await writeAssetFile(session.serverKeyId, newId, bytes);
    await db.insert(assets).values({
      id: newId,
      serverKeyId: session.serverKeyId,
      type: source.type,
      name: newName,
      width: source.width,
      height: source.height,
      ascent: source.ascent,
      codepoint: newCodepoint,
      fontMeta: source.fontMeta,
      contentHash: source.contentHash,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return c.json({ error: "Asset name or codepoint collision" }, 409);
    }
    return c.json({ error: "Failed to persist asset" }, 500);
  }

  const created = (await db.select().from(assets).where(eq(assets.id, newId)))[0];
  const _packInfo = await rebuildResourcePack(session.serverKeyId);
  pushResourcePackUpdated(session.serverKeyId, _packInfo.url, _packInfo.hash);
  return c.json({ asset: serialize(created) }, 200);
});

async function findFreeCopyName(
  serverKeyId: string,
  type: string,
  baseName: string,
): Promise<string> {
  // Try `<base>_copy`, then `<base>_copy2`, `<base>_copy3`, ... until free.
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? `${baseName}_copy` : `${baseName}_copy${i}`;
    const clash = await db.select().from(assets).where(
      and(
        eq(assets.serverKeyId, serverKeyId),
        eq(assets.type, type),
        eq(assets.name, candidate),
      ),
    );
    if (clash.length === 0) return candidate;
  }
  throw new Error("Could not find a free copy name after 1000 attempts");
}

assetsRouter.delete("/:token/assets/:id", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const rows = await db.select().from(assets)
    .where(and(eq(assets.id, id), eq(assets.serverKeyId, session.serverKeyId)));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);

  const target = rows[0];
  await db.delete(assets).where(eq(assets.id, id));
  if (target.type === "font") {
    await deleteFontAssets(session.serverKeyId, id);
  } else {
    await deleteAssetFile(session.serverKeyId, id);
  }
  const _packInfo = await rebuildResourcePack(session.serverKeyId);
  pushResourcePackUpdated(session.serverKeyId, _packInfo.url, _packInfo.hash);
  return c.body(null, 204);
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
